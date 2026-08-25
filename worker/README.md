# 블라블라링크 프로필 프록시

정적 사이트(GitHub Pages)는 블라블라링크 API를 직접 부를 수 없다. 두 가지가 동시에 막는다.

- API 응답에 `Access-Control-Allow-Origin`이 없다 — 브라우저가 응답을 읽지 못한다.
- 모든 조회 엔드포인트가 로그인 세션을 요구한다. 쿠키 없이 부르면 `300001 game not login`.

그래서 조회는 이 Worker가 대신 한다. 사이트는 프로필 URL만 넘기고, Worker가 자기 세션으로
블라블라링크에 물어본 **원시 응답**을 그대로 돌려준다. 해석(캐릭명 매칭·오버로드 환산 등)은
전부 브라우저가 한다 — Worker는 게임 데이터를 이해하지 않는다.

## 조회되는 범위

Worker의 세션은 남의 계정을 마음대로 못 본다. 블라블라링크가 **공개 설정된 프로필만**
내준다. 그래서 사용자는 블라블라링크에서 프로필과 니케 목록을 공개로 바꿔야 한다.
전초기지까지 공개면 콘솔(재활용 연구실) 레벨도 함께 온다.

## 배포

```bash
cd worker
npx wrangler login
npx wrangler secret put BLABLA_COOKIE   # 아래 "쿠키 얻기" 참고
npx wrangler deploy
```

배포하면 `https://nikke-calc-blabla.<계정>.workers.dev` 주소가 나온다. 그 주소를
`site/.env.production`의 `VITE_BLABLA_PROXY`에 적는다. 값이 비어 있으면 사이트는 프로필
URL 칸을 아예 그리지 않는다 — CSV만 남는다.

### 쿠키 얻기

**Application > Cookies 패널에서 긁지 말 것.** 거기서는 필요한 쿠키가 다 보이지 않아
`game_token`과 `game_uid`만 담기고, 그러면 상류가 `300001 game not login`으로 거절한다.
반드시 **실제로 나간 요청의 `Cookie:` 헤더**를 통째로 복사한다.

1. 크롬에서 `blablalink.com`에 로그인하고 게임 계정을 연동한다.
2. F12 → **Network** 탭을 연 채로 니케 도감(`/shiftyspad/nikke-list`) 같은 페이지를 연다.
3. 목록에서 `api.blablalink.com` 요청 아무거나 **우클릭 → Copy → Copy as cURL (bash)**.
4. 복사한 채로 그대로 실행한다 — 인자가 없으면 클립보드를 읽는다.

```bash
node worker/set-cookie.mjs
```

파일로 넘기고 싶으면 붙여넣어 저장한 뒤 `node worker/set-cookie.mjs curl.txt`.

스크립트가 `Cookie:` 헤더만 뽑아 **이 컴퓨터에서 먼저 로그인이 되는지 확인한 뒤에만**
wrangler에 넘긴다. 값은 화면에 찍히지 않는다. 파일로 넘겼다면 그 파일은 지운다.

여기서 `로그인이 안 됩니다 (300001 game not login)`가 뜨면 쿠키가 잘못된 것이다 —
워커 문제가 아니므로 3단계를 다시 한다.

직접 넣고 싶으면 `Cookie:` 헤더 값을 통째로 복사해
`npx wrangler secret put BLABLA_COOKIE`에 붙여넣어도 된다.

제대로 들어갔는지는 점검 엔드포인트로 확인한다 — 쿠키 값은 돌려주지 않고 모양만 센다.

```bash
curl -X POST https://<워커주소>/health   -H "Content-Type: application/json" -H "Origin: https://moris-kr.github.io"
```

`upstream.code`가 `0`이면 세션이 살아 있는 것이고, `300001`이면 아직 거절당하는 중이다.
`shape.hasGameOpenid`가 `false`면 3단계를 잘못 복사한 것이다.

쿠키는 만료된다. 만료되면 사이트가 "프록시 세션이 만료됐습니다"를 띄우므로 2~4단계를
다시 하면 된다. 이 계정 명의로 조회가 나가니 부계정을 쓰는 편이 낫다.

## API

```
POST /sync     {"profileUrl": "https://www.blablalink.com/user?openid=...", "area": 84}
POST /health   {}      세션 점검 — 쿠키 값은 절대 돌려주지 않고 모양과 상류 응답만 낸다
```

`area`는 선택값이다. 생략하면 아래 공식 서버를 모두 조회해 사이트가 보유 니케가 가장
많은 곳을 고르고, 주면 그 서버만 조회한다.

| 서버 | area |
|---|---:|
| 한국 | 83 |
| 일본 | 81 |
| 글로벌 | 84 |
| 북미 | 82 |
| 동남아 | 85 |

성공하면 이렇게 돌려준다. 지역이 여러 개 걸린 계정은 `areas`가 여러 개다.

```jsonc
{
  "openid": "1536…",
  "areas": [
    {
      "area": 83,
      "characters":  [ /* GetUserCharacters */ ],
      "details":     [ /* GetUserCharacterDetails */ ],
      "stateEffects":[ /* 오버로드 옵션 사전 */ ],
      "outpost":     { /* GetUserProfileOutpostInfo — 비공개면 null */ }
    }
  ]
}
```

실패는 `{"error": "...", "reason": "private|session|notfound|badurl|upstream"}` + 4xx/5xx.

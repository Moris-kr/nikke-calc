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

배포하면 `https://nikke-calc-blabla.<계정>.workers.dev` 주소가 나온다. 그 주소를 사이트
빌드의 `VITE_BLABLA_PROXY` 환경변수에 넣는다 (GitHub Actions는 리포지토리 variable).
값이 비어 있으면 사이트는 프로필 URL 칸을 아예 그리지 않는다 — CSV만 남는다.

### 쿠키 얻기

1. 크롬에서 `blablalink.com`에 로그인하고 게임 계정을 연동한다.
2. F12 → Application → Cookies → `https://www.blablalink.com`.
3. `game_token`과 `game_openid`를 포함한 쿠키 전부를 `이름=값; 이름=값` 한 줄로 잇는다.
4. 그 한 줄을 `wrangler secret put BLABLA_COOKIE`에 붙여넣는다.

쿠키는 만료된다. 만료되면 사이트가 "프록시 세션이 만료됐습니다"를 띄우므로 3~4단계를
다시 하면 된다. 이 계정 명의로 조회가 나가니 부계정을 쓰는 편이 낫다.

## API

```
POST /sync   {"profileUrl": "https://www.blablalink.com/user?openid=..."}
```

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

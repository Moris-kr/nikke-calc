/** 공개 서버 사용 안내. 계정 정보와 브라우저 프로필은 포함하지 않는다. */
import type { McpShare } from './mcp-share';
export const MCP_URL = 'https://nikke-calc-mcp.onrender.com/mcp';

export function renderMcpGuide(host: HTMLElement, getShare?: () => McpShare): void {
  host.innerHTML = `
    <section class="mcp-guide" data-mcp-guide aria-labelledby="mcp-heading">
      <header><p class="step">AI × NIKKE CALCULATOR</p>
        <h3 id="mcp-heading">대화하면서 편성 계산하기</h3>
        <p>ChatGPT·Claude에 계산기를 연결하면 캐릭터 정보 조회, 편성 대미지 계산, 설정 비교를 대화로 요청할 수 있습니다.</p>
      </header>
      <figure><img src="${import.meta.env.BASE_URL}tutorials/mcp-share-flow.svg" width="1080" height="400" alt="계산기에서 JSON 내보내기, AI에 첨부, MCP로 계산하는 세 단계"><figcaption>공유 과정 안내 그림. 연결을 마쳤다면 아래 확인 프롬프트부터 실행하세요.</figcaption></figure>
      <section class="mcp-address" aria-labelledby="mcp-address-heading">
        <h4 id="mcp-address-heading">1. 연결 주소 복사</h4>
        <label for="mcp-url">MCP 서버 주소</label>
        <div class="mcp-copy-row"><input id="mcp-url" data-mcp-url readonly value="${MCP_URL}" spellcheck="false">
          <button type="button" data-mcp-copy>주소 복사</button></div>
        <p data-mcp-copy-status role="status" aria-live="polite"></p>
        <p>이름: <strong>NIKKE Calculator</strong> · 인증: <strong>No Authentication (인증 없음)</strong></p>
        <p>서버 설치나 API 키 없이 사용할 수 있습니다. AI 서비스의 이용 요금·연결 권한은 별도입니다.</p>
        <details><summary>실제 사이트에서 MCP 탭 위치 보기</summary><figure><img loading="lazy" src="${import.meta.env.BASE_URL}tutorials/mcp-tab-screen.png" width="1265" height="712" alt="실제 계산기 화면의 편의 기능 탭과 MCP 하위 탭"><figcaption>계산기 실제 화면 · 2026-09-18 캡처. 편의 기능에서 MCP를 선택합니다.</figcaption></figure></details>
      </section>
      <div class="mcp-platforms">
        <section><h4>2. ChatGPT에 연결</h4>
          <ol><li>웹 ChatGPT의 <strong>설정 → 보안 및 로그인 → 개발자 모드</strong>를 켭니다.</li>
          <li><a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">Plugins 페이지 ↗</a>의 <strong>+</strong>에서 개발자 모드 앱을 만듭니다.</li>
          <li>위 이름과 서버 주소를 붙여 넣고 인증을 <strong>No Authentication</strong>으로 선택합니다.</li>
          <li>등록한 <strong>NIKKE Calculator</strong>의 상세 화면에서 도구 목록이 보이는지 확인합니다. 업데이트 후에는 <strong>새로고침(Refresh)</strong>으로 도구 목록을 갱신하세요.</li>
          <li>등록이 끝났다면 새 대화에 아래 <strong>연결 확인 프롬프트</strong>를 보내세요. 실제 도구 호출과 캐릭터 목록이 나오면 연결된 것입니다.</li></ol>
          <div class="mcp-example"><p data-mcp-check-prompt>NIKKE Calculator의 list_characters 도구를 호출해 사용 가능한 캐릭터 3명의 이름을 보여줘. 도구를 호출할 수 없으면 추측하지 말고 연결되지 않았다고 알려줘.</p><button type="button" data-mcp-check-copy>연결 확인 프롬프트 복사</button><p data-mcp-check-status role="status" aria-live="polite"></p></div>
          <p class="mcp-note">도구를 사용할 수 없다고 나오면 같은 계정에 앱이 등록되어 있는지, 앱 상세 화면의 도구가 활성화되어 있는지 확인하세요. 대화에서 앱 선택을 요구하는 화면이라면 NIKKE Calculator를 선택하세요. 메뉴 이름은 화면에 따라 다르므로 특정 메뉴 경로를 전제로 하지 않습니다.</p>
          <p class="mcp-note">메뉴가 없다면 요금제와 조직 정책을 확인해 주세요. 웹의 Plus·Pro·Business·Enterprise·Education 계정에서 지원됩니다.</p>
          <a href="https://developers.openai.com/api/docs/guides/developer-mode" target="_blank" rel="noopener noreferrer">ChatGPT 공식 안내 ↗</a>
        </section>
        <section><h4>2. Claude에 연결</h4>
          <ol><li><strong>Customize → Connectors</strong>를 엽니다.</li>
          <li><strong>+ → Add custom connector</strong>를 선택합니다.</li>
          <li>위 이름과 서버 주소를 입력합니다. OAuth Client ID·Secret은 비워 둡니다.</li>
          <li>새 대화의 <strong>+ → Connectors</strong>에서 연결을 켭니다.</li></ol>
          <p class="mcp-note">조직 계정은 관리자가 먼저 커넥터를 등록해야 할 수 있습니다. 로컬 설치 없이 공개 서버에 연결하는 방법입니다.</p>
          <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" target="_blank" rel="noopener noreferrer">Claude 공식 안내 ↗</a>
        </section>
      </div>
      <section aria-labelledby="mcp-share-heading"><h4 id="mcp-share-heading">3. 내 육성·편성 공유하기</h4>
        <p>블라블라링크·CSV에서 불러온 전체 육성과 현재 저장된 덱의 수정값, 싱크로·콘솔·전투 조건을 JSON 파일로 전달할 수 있습니다.</p>
        <div class="mcp-copy-row"><button type="button" data-mcp-download>육성·편성 JSON 다운로드</button>
          <button type="button" data-mcp-share-copy>JSON 복사</button></div>
        <p data-mcp-share-status role="status" aria-live="polite"></p>
        <details><summary>실제 JSON 내보내기 화면 보기</summary><figure><img loading="lazy" src="${import.meta.env.BASE_URL}tutorials/mcp-share-screen.png" width="1265" height="712" alt="실제 계산기의 육성·편성 JSON 다운로드와 JSON 복사 버튼 및 첨부 안내"><figcaption>기본 예시 편성으로 찍은 실제 화면입니다. 불러온 육성이 0명이면 로스터는 비어 있고, 덱 설정은 별도로 전달됩니다.</figcaption></figure></details>
        <textarea data-mcp-share-fallback hidden readonly aria-label="공유 JSON 수동 복사" rows="6"></textarea>
        <ol><li>계산기에서 육성을 불러오고 원하는 편성·전투 조건을 설정하세요.</li>
          <li>위 버튼으로 파일을 내려받아 MCP를 연결한 ChatGPT·Claude 대화에 첨부하세요. 파일을 읽지 못하면 <strong>JSON 복사</strong>로 내용을 붙여 넣으세요.</li>
          <li>아래 문장을 함께 보내세요. AI가 파일 내용을 도구의 <code>state</code>에 JSON 객체로 전달해야 합니다. 파일명이나 경로만 전달하면 안 됩니다.</li></ol>
        <div class="mcp-example"><p>첨부한 JSON을 NIKKE Calculator의 inspect_shared_state로 검증해서 전체 육성과 덱 목록을 확인해 줘. 그다음 simulate_shared_state에 같은 state와 deck_index: 1을 전달해 첫 번째 덱을 그대로 계산하고 적용 육성과 대미지를 알려 줘.</p></div>
        <p>새 조합은 <code>simulate_shared_state</code>의 <code>squad</code>에 정식 이름을 지정합니다. 이때 덱 수정값 대신 불러온 로스터 육성과 공통 전투 조건을 사용합니다. 로스터에 없는 캐릭터는 자동으로 기본 육성으로 채우지 않습니다.</p>
        <p class="mcp-note">스킬·돌파/코어·장비·오버로드 합계·큐브·소장품/애장품·수동 스탯·운용 설정을 담습니다. 부위별 오버로드 줄은 계산에 쓰는 합계로 전달됩니다. 입력하지 않은 항목은 계산기 기본값이며, 실계정 정보로 확정되는 것은 아닙니다. 보유 재료 수량과 계산 결과는 포함하지 않습니다.</p>
        <p class="mcp-note">닉네임·계정 ID·프로필 주소·덱 이름·쿠키·대화 내역은 담지 않습니다. 파일의 육성 정보는 첨부한 AI 서비스와 도구 호출 시 계산 서버에 전달됩니다. 계산 서버는 저장하지 않습니다. 웹과 자동 동기화되지 않으므로 수정 후 다시 내보내고, 매 도구 호출에 같은 JSON을 전달하세요. 커스텀 캐릭터·핵 옵션은 지원하지 않습니다.</p>
      </section>
      <section><h4>4. 이렇게 물어보세요</h4>
        <div class="mcp-example"><p>NIKKE Calculator로 사용 가능한 캐릭터 목록을 확인해 줘.</p></div>
        <div class="mcp-example"><p>리타, 크라운, 신데렐라, 모더니아, 나가를 기본 스펙으로 180초 계산해 줘. 적 방어력 31784, 속성 없음, 코어 없음으로 하고 캐릭터별 대미지와 계산 조건을 알려 줘.</p></div>
        <div class="mcp-example"><p>방금 편성에서 신데렐라의 큐브만 없음과 렐릭 베어 큐브 Lv7로 바꿔 비교해 줘. 사용 가능한 큐브 이름을 먼저 확인하고, 나머지 조건은 동일하게 유지해 줘.</p></div>
        <p>AI가 실제 계산 도구를 호출했는지 확인하세요. 비교 결과는 요청한 후보 사이의 순위이며 모든 조합의 최적해를 보장하지 않습니다.</p>
      </section>
      <section><h4>연결이 늦거나 결과가 다를 때</h4>
        <ul><li>무료 서버는 미사용 시 절전합니다. <a href="https://nikke-calc-mcp.onrender.com/health" target="_blank" rel="noopener noreferrer">서버 상태 확인 ↗</a>에서 <code>status: ok</code>가 나온 뒤 다시 시도하세요. 처음에는 약 1분 걸릴 수 있습니다.</li>
        <li>동시 계산은 1개입니다. 사용 중이라는 응답이 오면 잠시 뒤 다시 요청하세요.</li>
        <li>웹과 결과가 다르면 공유 파일을 다시 내보내고 같은 덱 번호·전투 조건인지 확인하세요. 서버와 웹의 데이터 버전이 다르거나 기본값이 바뀌면 결과도 달라질 수 있습니다.</li>
        <li>계산에 필요한 입력만 서버로 전달됩니다. 블라블라링크 쿠키나 계정 비밀번호는 입력하지 마세요.</li></ul>
        <a href="https://github.com/Moris-kr/nikke-calc/blob/master/docs/MCP_SETUP.md" target="_blank" rel="noopener noreferrer">로컬 설치·직접 배포 상세 안내 ↗</a>
      </section>
    </section>`;
  const input = host.querySelector<HTMLInputElement>('[data-mcp-url]')!;
  host.querySelector<HTMLButtonElement>('[data-mcp-check-copy]')!.addEventListener('click', async () => {
    const status = host.querySelector<HTMLElement>('[data-mcp-check-status]')!;
    try {
      await navigator.clipboard.writeText(host.querySelector('[data-mcp-check-prompt]')!.textContent!);
      status.textContent = '복사했습니다. 새 대화에 붙여 넣으세요.';
    } catch { status.textContent = '위 문장을 선택해 직접 복사해 주세요.'; }
  });
  const status = host.querySelector<HTMLElement>('[data-mcp-copy-status]')!;
  host.querySelector<HTMLButtonElement>('[data-mcp-copy]')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      status.textContent = '주소를 복사했습니다.';
    } catch {
      input.focus();
      input.select();
      status.textContent = '주소를 선택했습니다. Ctrl+C 또는 길게 눌러 복사해 주세요.';
    }
  });
  const shareStatus = host.querySelector<HTMLElement>('[data-mcp-share-status]')!;
  const fallback = host.querySelector<HTMLTextAreaElement>('[data-mcp-share-fallback]')!;
  for (const action of ['download', 'share-copy']) {
    const button = host.querySelector<HTMLButtonElement>(`[data-mcp-${action}]`)!;
    button.disabled = !getShare;
    button.addEventListener('click', async () => {
      try {
        const share = getShare!();
        const json = JSON.stringify(share, null, 2);
        const count = `불러온 육성 ${Object.keys(share.roster).length}명 · 편성 ${share.decks.length}개`;
        fallback.hidden = true;
        if (action === 'download') {
          const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'nikke-calc-mcp.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          shareStatus.textContent = `${count}를 파일로 내보냈습니다. AI 대화에 첨부하세요.`;
        } else {
          try {
            await navigator.clipboard.writeText(json);
            shareStatus.textContent = `${count}를 복사했습니다. AI 대화에 붙여 넣으세요.`;
          } catch {
            fallback.value = json;
            fallback.hidden = false;
            fallback.focus();
            fallback.select();
            shareStatus.textContent = `${count} · 아래 JSON을 Ctrl+C 또는 길게 눌러 복사해 주세요.`;
          }
        }
      } catch (error) {
        shareStatus.textContent = error instanceof Error ? error.message : '공유 파일을 만들지 못했습니다.';
      }
    });
  }
}

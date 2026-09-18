/** 공개 서버 사용 안내. 계정 정보와 브라우저 프로필은 포함하지 않는다. */
import type { McpShare } from './mcp-share';
import type { BrowserMcpConnection } from './mcp-browser';
export const MCP_URL = 'https://nikke-calc-mcp.onrender.com/mcp';

export function renderMcpGuide(host: HTMLElement, getShare?: () => McpShare, connection?: BrowserMcpConnection): void {
  host.innerHTML = `
    <section class="mcp-guide" data-mcp-guide aria-labelledby="mcp-heading">
      <header><p class="step">AI × NIKKE CALCULATOR</p>
        <h3 id="mcp-heading">대화하면서 편성 계산하기</h3>
        <p>ChatGPT·Claude가 요청한 계산을 <strong>지금 사용하는 컴퓨터·브라우저</strong>에서 실행합니다. 서버는 요청과 결과만 전달합니다.</p>
      </header>
      <figure><img src="${import.meta.env.BASE_URL}tutorials/mcp-share-flow.svg" width="1080" height="400" alt="AI가 요청하고 서버가 전달하면 사용자 브라우저에서 계산해 결과를 반환하는 과정"><figcaption>AI 앱 등록은 한 번만, 브라우저 연결은 사용할 때 켜 주세요.</figcaption></figure>
      <section class="mcp-address" aria-labelledby="mcp-address-heading">
        <h4 id="mcp-address-heading">1. 연결 주소 복사</h4>
        <label for="mcp-url">MCP 서버 주소</label>
        <div class="mcp-copy-row"><input id="mcp-url" data-mcp-url readonly value="${MCP_URL}" spellcheck="false">
          <button type="button" data-mcp-copy>주소 복사</button></div>
        <p data-mcp-copy-status role="status" aria-live="polite"></p>
        <p>이름: <strong>NIKKE Calculator</strong> · 인증: <strong>No Authentication (인증 없음)</strong></p>
        <p>서버 설치나 API 키 없이 사용할 수 있습니다. AI 서비스의 이용 요금·연결 권한은 별도입니다.</p>
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
      <section class="mcp-address" aria-labelledby="mcp-browser-heading"><h4 id="mcp-browser-heading">3. 이 브라우저에서 AI 연결 켜기</h4>
        <p>육성·편성·전투 조건을 준비한 뒤 <strong>AI 연결</strong>을 누르세요. 연결 코드가 있는 AI는 현재 육성을 조회하고 이 기기에서 계산할 수 있습니다.</p>
        <div class="mcp-copy-row"><button type="button" data-mcp-connect>AI 연결</button><button type="button" data-mcp-disconnect disabled>연결 해제 · 계산 중단</button></div>
        <p data-mcp-connection-status role="status" aria-live="polite">연결 꺼짐</p>
        <label for="mcp-connection-code">이번 브라우저 연결 코드</label>
        <input id="mcp-connection-code" data-mcp-code readonly value="" placeholder="AI 연결을 누르면 발급됩니다" autocomplete="off" spellcheck="false">
        <div class="mcp-example"><p data-mcp-browser-prompt>연결 후 여기에 사용할 프롬프트가 표시됩니다.</p><button type="button" data-mcp-browser-copy disabled>연결·계산 프롬프트 복사</button><p data-mcp-browser-copy-status role="status"></p></div>
        <p>AI는 먼저 작업 번호를 받고 <code>get_browser_result</code>로 완료 결과를 조회합니다. 기다리는 중이라고 나오면 “그 작업의 결과를 다시 확인해 줘”라고 요청하세요. 작업을 새로 제출할 필요는 없습니다.</p>
        <p class="mcp-note">이 탭을 열어 두고 기기가 절전되지 않게 해 주세요. 탭 이동은 가능하지만 모바일 백그라운드에서는 연결이 끊길 수 있습니다. 연결은 최대 2시간, 응답이 없으면 약 45초 후 만료됩니다. 서버 재시작·새로고침 후에는 새 코드를 발급하세요.</p>
        <p class="mcp-note">코드는 육성 조회·계산 권한입니다. 공개 게시물이나 스크린샷에 노출하지 마세요. 요청한 육성과 결과는 AI 서비스 및 중계 서버를 거치며 서버 메모리에 잠시 보관됩니다(결과 최대 5분). 연결 해제로 폐기할 수 있습니다. 닉네임·계정 ID·쿠키·대화 내역은 보내지 않습니다.</p>
      </section>
      <section aria-labelledby="mcp-share-heading"><h4 id="mcp-share-heading">선택: JSON 파일로 육성·편성 전달하기</h4>
        <p>블라블라링크·CSV에서 불러온 전체 육성과 현재 저장된 덱의 수정값, 싱크로·콘솔·전투 조건을 JSON 파일로 전달할 수 있습니다.</p>
        <div class="mcp-copy-row"><button type="button" data-mcp-download>육성·편성 JSON 다운로드</button>
          <button type="button" data-mcp-share-copy>JSON 복사</button></div>
        <p data-mcp-share-status role="status" aria-live="polite"></p>
        <textarea data-mcp-share-fallback hidden readonly aria-label="공유 JSON 수동 복사" rows="6"></textarea>
        <ol><li>계산기에서 육성을 불러오고 원하는 편성·전투 조건을 설정하세요.</li>
          <li>위 버튼으로 파일을 내려받아 MCP를 연결한 ChatGPT·Claude 대화에 첨부하세요. 파일을 읽지 못하면 <strong>JSON 복사</strong>로 내용을 붙여 넣으세요.</li>
          <li>아래 문장을 함께 보내세요. AI가 파일 내용을 도구의 <code>state</code>에 JSON 객체로 전달해야 합니다. 파일명이나 경로만 전달하면 안 됩니다.</li></ol>
        <div class="mcp-example"><p>첨부한 JSON을 NIKKE Calculator의 inspect_shared_state로 검증해 줘. simulate_shared_state에 같은 state, deck_index: 1과 내가 준 connection_code를 전달하고, 받은 jobId를 get_browser_result로 조회해서 완료된 실제 결과를 알려 줘.</p></div>
        <p>새 조합은 <code>simulate_shared_state</code>의 <code>squad</code>에 정식 이름을 지정합니다. 이때 덱 수정값 대신 불러온 로스터 육성과 공통 전투 조건을 사용합니다. 로스터에 없는 캐릭터는 자동으로 기본 육성으로 채우지 않습니다.</p>
        <p class="mcp-note">스킬·돌파/코어·장비·오버로드 합계·큐브·소장품/애장품·수동 스탯·운용 설정을 담습니다. 부위별 오버로드 줄은 계산에 쓰는 합계로 전달됩니다. 입력하지 않은 항목은 계산기 기본값이며, 실계정 정보로 확정되는 것은 아닙니다. 보유 재료 수량과 계산 결과는 포함하지 않습니다.</p>
        <p class="mcp-note">닉네임·계정 ID·프로필 주소·덱 이름·쿠키·대화 내역은 담지 않습니다. 파일은 AI 서비스와 중계 서버로 전달되며, 계산은 연결된 브라우저에서 합니다. JSON은 자동 동기화되지 않으므로 수정 후 다시 내보내세요. AI 연결 방식은 요청 시점의 현재 설정을 읽습니다. 커스텀 캐릭터·핵 옵션은 지원하지 않습니다.</p>
      </section>
      <section><h4>4. 이렇게 물어보세요</h4>
        <div class="mcp-example"><p>NIKKE Calculator로 사용 가능한 캐릭터 목록을 확인해 줘.</p></div>
        <div class="mcp-example"><p>리타, 크라운, 신데렐라, 모더니아, 나가를 기본 스펙으로 180초 계산해 줘. 적 방어력 31784, 속성 없음, 코어 없음으로 하고 캐릭터별 대미지와 계산 조건을 알려 줘.</p></div>
        <div class="mcp-example"><p>방금 편성에서 신데렐라의 큐브만 없음과 렐릭 베어 큐브 Lv7로 바꿔 비교해 줘. 사용 가능한 큐브 이름을 먼저 확인하고, 나머지 조건은 동일하게 유지해 줘.</p></div>
        <p>AI가 실제 계산 도구를 호출했는지 확인하세요. 비교 결과는 요청한 후보 사이의 순위이며 모든 조합의 최적해를 보장하지 않습니다.</p>
      </section>
      <section><h4>연결이 늦거나 결과가 다를 때</h4>
        <ul><li>무료 서버는 미사용 시 절전합니다. <a href="https://nikke-calc-mcp.onrender.com/health" target="_blank" rel="noopener noreferrer">서버 상태 확인 ↗</a>에서 <code>status: ok</code>가 나온 뒤 다시 시도하세요. 처음에는 약 1분 걸릴 수 있습니다.</li>
        <li>브라우저 연결마다 한 작업씩 처리합니다. 다른 사람의 계산을 기다릴 필요가 없습니다. 작업이 진행 중이면 기존 작업 번호로 결과를 조회하세요.</li>
        <li><code>CALCULATION_TIMEOUT</code>은 계산 시간 초과, <code>INVALID_SETTINGS</code>는 입력 설정 오류입니다. 메시지의 원인을 확인하세요. <code>INVALID_ARGUMENT</code>나 <code>Error executing tool</code>만 보이면 특정 캐릭터가 계산 불가능하다고 단정하지 말고 상세 오류와 호출 입력을 확인하세요.</li>
        <li>연결 관련 오류가 나오면 이 탭에서 연결을 해제한 뒤 다시 켜고 새 코드를 알려 주세요. 서버에서 계산을 대신 실행하지 않습니다. 웹과 결과가 다르면 적용 육성·편성 번호·전투 조건을 확인하세요.</li>
        <li>계산에 필요한 입력만 서버로 전달됩니다. 블라블라링크 쿠키나 계정 비밀번호는 입력하지 마세요.</li></ul>
        <a href="https://github.com/Moris-kr/nikke-calc/blob/master/docs/MCP_SETUP.md" target="_blank" rel="noopener noreferrer">로컬 설치·직접 배포 상세 안내 ↗</a>
      </section>
    </section>`;
  const connect = host.querySelector<HTMLButtonElement>('[data-mcp-connect]')!;
  const disconnect = host.querySelector<HTMLButtonElement>('[data-mcp-disconnect]')!;
  const prompt = host.querySelector<HTMLElement>('[data-mcp-browser-prompt]')!;
  const copyPrompt = host.querySelector<HTMLButtonElement>('[data-mcp-browser-copy]')!;
  connect.disabled = !connection;
  connection?.subscribe(state => {
    if (!host.querySelector('[data-mcp-connection-status]')) return;
    connect.disabled = state.connecting || !!state.code;
    disconnect.disabled = !state.connecting && !state.code;
    copyPrompt.disabled = !state.code;
    host.querySelector<HTMLInputElement>('[data-mcp-code]')!.value = state.code;
    host.querySelector<HTMLElement>('[data-mcp-connection-status]')!.textContent = state.message;
    prompt.textContent = state.code
      ? `NIKKE Calculator의 내 브라우저 연결 코드는 ${state.code}야. inspect_browser_state에 connection_code를 전달하고, 받은 jobId를 get_browser_result(connection_code, job_id)로 조회해 현재 육성·편성을 확인해 줘. 그다음 simulate_browser_state에 같은 connection_code와 deck_index: 1을 전달하고 get_browser_result로 완료 결과를 확인해 첫 번째 편성의 적용 육성과 대미지를 알려 줘. 진행 중이면 같은 작업을 조회하고, 실제 결과 없이 숫자를 추측하지 마.`
      : '연결 후 여기에 사용할 프롬프트가 표시됩니다.';
  });
  connect.addEventListener('click', () => void connection?.connect());
  disconnect.addEventListener('click', () => connection?.disconnect());
  copyPrompt.addEventListener('click', async () => {
    const status = host.querySelector<HTMLElement>('[data-mcp-browser-copy-status]')!;
    try { await navigator.clipboard.writeText(prompt.textContent!); status.textContent = '복사했습니다. 연결한 AI 대화에 붙여 넣으세요.'; }
    catch { status.textContent = '위 문장을 선택해 직접 복사해 주세요.'; }
  });
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

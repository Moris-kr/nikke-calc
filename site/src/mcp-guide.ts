/** 공개 서버 사용 안내. 계정 정보와 브라우저 프로필은 포함하지 않는다. */
import type { BrowserMcpConnection } from './mcp-browser';
export const MCP_URL = 'https://nikke-calc-mcp.onrender.com/mcp';

export function renderMcpGuide(host: HTMLElement, connection?: BrowserMcpConnection): void {
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
      <section><h4>PVP·아레나 추천도 질문할 수 있어요</h4>
        <p>“아레나 검색 지침을 읽고 <a href="https://nikkeari.cc/ko" target="_blank" rel="noopener noreferrer">니케아리</a>에서 한국 서버 공격덱을 찾아 줘. 시즌·경기 수·상대 편성도 확인해 줘”라고 요청하세요. 상대 편성과 필수·제외 니케를 함께 알려주면 좋습니다.</p>
        <p>AI의 웹·브라우저 접근이 필요합니다. 챔피언 아레나 기록을 참고하며, 루키·스페셜의 승리를 보장하거나 계산기의 PvE 대미지로 아레나 승패를 판정하지 않습니다.</p>
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
        <p>파일을 따로 전달할 필요 없이 요청 시점의 브라우저 설정을 읽습니다. 저장된 덱을 계산하면 덱별 수정값을, 새 조합을 계산하면 불러온 전체 육성을 사용합니다. 입력하지 않은 값은 계산기 기본값입니다.</p>
        <div class="mcp-copy-row"><button type="button" data-mcp-connect>AI 연결</button><button type="button" data-mcp-disconnect disabled>연결 해제 · 계산 중단</button></div>
        <p data-mcp-connection-status role="status" aria-live="polite">연결 꺼짐</p>
        <label for="mcp-connection-code">이번 브라우저 연결 코드</label>
        <input id="mcp-connection-code" data-mcp-code readonly value="" placeholder="AI 연결을 누르면 발급됩니다" autocomplete="off" spellcheck="false">
        <div class="mcp-example"><p data-mcp-browser-prompt>연결 후 여기에 사용할 프롬프트가 표시됩니다.</p><button type="button" data-mcp-browser-copy disabled>연결·계산 프롬프트 복사</button><p data-mcp-browser-copy-status role="status"></p></div>
        <p>AI는 먼저 작업 번호를 받고 <code>get_browser_result</code>로 완료 결과를 조회합니다. 기다리는 중이라고 나오면 “그 작업의 결과를 다시 확인해 줘”라고 요청하세요. 작업을 새로 제출할 필요는 없습니다.</p>
        <p class="mcp-note">이 탭을 열어 두고 기기가 절전되지 않게 해 주세요. 탭 이동은 가능하지만 모바일 백그라운드에서는 연결이 끊길 수 있습니다. 연결은 최대 2시간, 응답이 없으면 약 45초 후 만료됩니다. 서버 재시작·새로고침 후에는 새 코드를 발급하세요.</p>
        <p class="mcp-note">코드는 육성 조회·계산 권한입니다. 공개 게시물이나 스크린샷에 노출하지 마세요. 요청한 육성과 결과는 AI 서비스 및 중계 서버를 거치며 서버 메모리에 잠시 보관됩니다(결과 최대 5분). 연결 해제로 폐기할 수 있습니다. 닉네임·계정 ID·쿠키·대화 내역은 보내지 않습니다.</p>
      </section>
      <section><h4>4. 이렇게 물어보세요</h4>
        <p>덱 추천에는 ENIKK 검색 지침이 제공됩니다. AI가 웹 검색·브라우저를 사용할 수 있어야 최신 기록까지 확인할 수 있습니다. 처음에는 앱의 도구 목록을 새로고침해 주세요.</p>
        <div class="mcp-example"><p>내 육성으로 캠페인 덱 짜줘. NIKKE Calculator의 추천 검색 지침을 먼저 읽고 ENIKK의 Hard 기록을 참고해 줘. Normal 요청이면 Normal 데이터가 없어 Hard 덱을 기준으로 추천한다고 설명해 줘. 스테이지와 난이도가 필요하면 물어봐.</p></div>
        <div class="mcp-example"><p>수냉 약점 솔로레이드용 중복 없는 5덱을 내 육성으로 짜줘. ENIKK에서 기록이 있는 최근 시즌과 사용 표본을 확인하고 후보를 계산해 줘.</p></div>
        <div class="mcp-example"><p>유니온레이드 핑거즈 덱 짜줘. 시즌과 Fingers / Rebuild Fingers를 구분하고, 보스 레벨·약점·기믹을 확인해서 내 육성으로 비교해 줘.</p></div>
        <p>ENIKK 사용률은 성능 점수나 승률이 아닙니다. AI는 출처·자료 날짜·표본과 실제 계산 결과를 구분해야 하며, 자료에 접근하지 못했다면 확인하지 못했다고 알려야 합니다.</p>
        <p>AI가 실제 계산 도구를 호출했는지 확인하세요. 비교 결과는 요청한 후보 사이의 순위이며 모든 조합의 최적해를 보장하지 않습니다.</p>
        <div class="mcp-example"><p>내 민트의 현재 육성을 기준으로 예상 전투력을 비교해 줘. 장비를 머리 4·팔 3·몸통 1·다리 0강으로 바꾸는 경우와, 소장품만 SR5 또는 SR15로 바꾸는 경우를 각각 독립적으로 계산하고 현재 대비 증감을 보여 줘. compare_browser_growth를 사용하고 저장된 육성은 바꾸지 마.</p></div>
        <p>코어 노출은 전투 설정의 고급 설정에서 여러 구간으로 지정할 수 있습니다. 예를 들어 “코어는 30~60초, 90~120초에만 노출되도록 계산해 줘”라고 요청하세요. 구간이 없으면 코어가 상시 노출되며, 코어 없음 설정이 우선합니다.</p>
        <p>전용 MCP 도구가 없는 기능도 AI가 브라우저 조작 도구를 갖고 있다면 계산기 화면을 확인해 진행할 수 있습니다. 실제 육성이 있는 탭을 사용해야 하며, 브라우저 조작이 불가능하면 직접 따라 할 메뉴와 입력 방법을 안내합니다.</p>
      </section>
      <section><h4>육성 목표와 모듈 가성비를 MCP로 계산하기</h4>
        <ol><li>계산 결과에서 <strong>육성효율 계산하기</strong>를 열고 목표 줄 수·육성치·잠금 재화를 설정합니다.</li><li>AI 연결을 켜고 <code>export_overload_plan</code>으로 현재 목표를 조회합니다. 이 도구는 설정값만 전달합니다.</li><li><code>calculate_overload_plan</code>을 요청하면 사용자 브라우저에서 육성 비교와 모듈 가성비를 계산합니다.</li><li><code>get_browser_result</code>로 결과를 받아 설명하도록 요청하세요. 계산 중에는 페이지를 열어 두세요.</li></ol>
        <div class="mcp-example"><p>export_overload_plan으로 내가 설정한 목표를 확인하고, calculate_overload_plan으로 내 브라우저에서 계산해줘. get_browser_result로 결과를 받아 옵션 찾기·수치작·잠금 모듈과 락 키 소모를 나누어 설명해줘.</p></div>
        <p>엔진 코드·실행 프롬프트·ZIP을 AI에 전달하지 않습니다. 목표는 육성효율 창에서 변경하며, AI는 브라우저에서 계산된 수치를 해석합니다.</p>
      </section>
      <section><h4>AI로 보스 메이커 구성하기</h4>
        <p><code>create_boss_code</code>로 보스의 몸통·코어·파츠·노출 시간과 전투 조건을 구성한 <strong>NK5- 공유 코드</strong>를 받을 수 있습니다. 코드 생성에는 브라우저 연결 코드가 필요하지 않습니다. 실제 대미지 계산은 보스 메이커에서 내 브라우저로 실행합니다.</p>
        <div class="mcp-example"><p>create_boss_code로 테스트용 보스를 만들어줘. 180초, 작열, 방어력 31784, 코어 직경 52px, 파츠 없음, 코어는 30~60초와 90~120초만 노출. 60~90초에는 바디 방어율 60%, 0~30초에는 AR만 적정거리. 코어·파츠·적정거리는 전투 조건 입력값을 쓰도록 settingsSource를 battle로 설정하고, NK5 코드를 생략 없이 줘. 도형은 설명용 예시임을 밝혀줘.</p></div>
        <ol><li>AI 앱에서 NIKKE Calculator 도구 목록을 새로고침합니다.</li><li>원하는 조건을 설명하고 <code>create_boss_code</code> 호출과 NK5 코드 반환을 요청합니다.</li><li>계산기 → 보스 메이커 → 공유에서 받은 코드 넣기에 붙여넣고 새 보스로 받기를 누릅니다. 기존 보스는 유지되고 새 저장본이 추가됩니다.</li><li><strong>전체 전투 조건 편집</strong>에서 조건을 확인한 뒤 현재 덱 또는 모든 덱을 계산합니다.</li></ol>
        <p><strong>도형에서 계산</strong>은 그림의 코어·파츠·조준 위치에 따른 적정거리를 사용합니다. <strong>전투 조건 입력값 사용</strong>은 입력한 코어·파츠·적정거리와 덱별 설정을 사용하며 그림은 참고용입니다. AI가 모르는 실제 크기·위치·방어율은 추정임을 밝혀야 합니다. 공유 코드에는 내 육성·싱크로·콘솔·핵 설정이 들어가지 않습니다.</p>
      </section>
      <section><h4>덱 추천은 이렇게 비교합니다</h4>
        <p>AI가 ENIKK의 같은 콘텐츠 기록에서 후보를 찾고, <strong>현재 브라우저 육성으로 최대 20개 후보</strong>를 계산합니다. 1~5덱을 요청하면 캐릭터가 겹치지 않는 조합을 함께 비교합니다. 모든 추천 덱에 실제 발동 가능한 <strong>아군 버스트 쿨타임 감소</strong>를 확인하며, 솔린 대신 바니 소다를 쓰는 샷건덱만 예외로 다룹니다. 직접 지정한 덱에 쿨감이 없다면 의도를 한 번 확인합니다.</p>
        <p>예시: “현재 전투 조건과 내 육성으로 수냉 약점 솔로레이드 5덱 후보를 찾아줘. get_recommendation_guide와 get_recommendation_evidence를 읽고 ENIKK 최신 기록을 확인한 다음, recommend_browser_squads로 중복 없이 비교해줘. 쿨감 담당과 제외된 후보 이유도 알려줘.”</p>
        <p>코어·파츠 등 조건에 따른 순위 변동도 비교할 수 있습니다. 사용률은 승률이 아니며, 결과는 입력한 후보 안에서의 비교입니다. 캠페인은 <strong>Hard 기록</strong>을 참고하고 Normal 요청에는 그 한계를 설명합니다. 생존·웨이브·컨트롤은 별도로 검토해야 합니다.</p>
        <p>새 도구가 보이지 않으면 AI 앱에서 NIKKE Calculator 도구 목록을 Refresh하고, 이 페이지도 새로고침한 뒤 AI 연결 코드를 다시 전달하세요. 많은 후보는 최대 20분 걸릴 수 있습니다. 계산 중에는 탭을 열어 두고, 중단하려면 연결을 해제하세요.</p>
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
}

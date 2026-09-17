/** 공개 서버 사용 안내. 계정 정보와 브라우저 프로필은 포함하지 않는다. */
export const MCP_URL = 'https://nikke-calc-mcp.onrender.com/mcp';

export function renderMcpGuide(host: HTMLElement): void {
  host.innerHTML = `
    <section class="mcp-guide" data-mcp-guide aria-labelledby="mcp-heading">
      <header><p class="step">AI × NIKKE CALCULATOR</p>
        <h3 id="mcp-heading">대화하면서 편성 계산하기</h3>
        <p>ChatGPT·Claude에 계산기를 연결하면 캐릭터 정보 조회, 편성 대미지 계산, 설정 비교를 대화로 요청할 수 있습니다.</p>
      </header>
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
          <li>새 대화의 <strong>+ → 개발자 모드</strong>에서 NIKKE Calculator를 선택합니다.</li></ol>
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
      <section><h4>3. 이렇게 물어보세요</h4>
        <div class="mcp-example"><p>NIKKE Calculator로 사용 가능한 캐릭터 목록을 확인해 줘.</p></div>
        <div class="mcp-example"><p>리타, 크라운, 신데렐라, 모더니아, 나가를 기본 스펙으로 180초 계산해 줘. 적 방어력 31784, 속성 없음, 코어 없음으로 하고 캐릭터별 대미지와 계산 조건을 알려 줘.</p></div>
        <div class="mcp-example"><p>방금 편성에서 신데렐라의 큐브만 없음과 렐릭 베어 큐브 Lv7로 바꿔 비교해 줘. 사용 가능한 큐브 이름을 먼저 확인하고, 나머지 조건은 동일하게 유지해 줘.</p></div>
        <p>AI가 실제 계산 도구를 호출했는지 확인하세요. 비교 결과는 요청한 후보 사이의 순위이며 모든 조합의 최적해를 보장하지 않습니다.</p>
      </section>
      <section><h4>연결이 늦거나 결과가 다를 때</h4>
        <ul><li>무료 서버는 미사용 시 절전합니다. <a href="https://nikke-calc-mcp.onrender.com/health" target="_blank" rel="noopener noreferrer">서버 상태 확인 ↗</a>에서 <code>status: ok</code>가 나온 뒤 다시 시도하세요. 처음에는 약 1분 걸릴 수 있습니다.</li>
        <li>동시 계산은 1개입니다. 사용 중이라는 응답이 오면 잠시 뒤 다시 요청하세요.</li>
        <li>웹사이트에서 저장한 편성·육성·블라블라링크 프로필은 자동으로 넘어가지 않습니다. 스킬 레벨, 장비, 큐브, 적 조건을 대화에 직접 지정하세요.</li>
        <li>계산에 필요한 입력만 서버로 전달됩니다. 블라블라링크 쿠키나 계정 비밀번호는 입력하지 마세요.</li></ul>
        <a href="https://github.com/Moris-kr/nikke-calc/blob/master/docs/MCP_SETUP.md" target="_blank" rel="noopener noreferrer">로컬 설치·직접 배포 상세 안내 ↗</a>
      </section>
    </section>`;
  const input = host.querySelector<HTMLInputElement>('[data-mcp-url]')!;
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

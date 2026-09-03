/**
 * 되돌릴 수 없는 단추는 **한 번에 안 터지게** 한다.
 *
 * 「저장」 바로 아래 붙은 「삭제」를 «적용»으로 착각해 프리셋을 몇 번 날렸다는 이야기가
 * 나왔다. 실수의 값이 「다시 만들면 되는 일」이 아니라 「되찾을 수 없는 일」이면, 한 번
 * 더 묻는 값은 언제나 싸다.
 *
 * 창을 띄우지 않는 이유는 목록에서 여러 개를 지울 때 창이 흐름을 끊기 때문이다. 대신
 * 단추 자신이 «정말 지울까요?»로 바뀌고, 그 상태에서 한 번 더 눌러야 실제로 지운다 —
 * 빠르게 두 번 누르면(더블클릭) 그대로 지워지므로 손에 익은 사람은 느려지지 않는다.
 *
 * 겨눔은 잠깐만 산다. 눌러 둔 것을 잊고 한참 뒤에 스치듯 누른 것까지 «확인»으로 세면
 * 그것은 확인이 아니다.
 */

/** 겨눔이 살아 있는 시간(ms). */
export const ARM_MS = 3_000;

export interface ArmOptions {
  /** 겨눈 동안 단추에 적을 말. */
  armed?: string;
  /** 시험에서 시계를 갈아 끼우는 자리. */
  now?: () => number;
  timer?: {
    set: (fn: () => void, ms: number) => number;
    clear: (id: number) => void;
  };
}

/**
 * 단추를 «두 번 눌러야 터지는» 것으로 바꾼다. 되돌리는 함수를 낸다.
 */
export function confirmTwice(
  button: HTMLButtonElement,
  run: () => void,
  options: ArmOptions = {},
): () => void {
  const armedLabel = options.armed ?? '정말 지울까요?';
  const idle = button.textContent ?? '';
  const set = options.timer?.set ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clear = options.timer?.clear ?? ((id) => window.clearTimeout(id));
  let timer: number | null = null;

  const disarm = () => {
    if (timer !== null) { clear(timer); timer = null; }
    button.textContent = idle;
    button.classList.remove('is-armed');
    button.removeAttribute('data-armed');
  };

  const onClick = () => {
    if (button.dataset.armed === '1') {
      disarm();
      run();
      return;
    }
    button.dataset.armed = '1';
    button.classList.add('is-armed');
    button.textContent = armedLabel;
    timer = set(disarm, ARM_MS);
  };

  button.addEventListener('click', onClick);
  return () => { disarm(); button.removeEventListener('click', onClick); };
}

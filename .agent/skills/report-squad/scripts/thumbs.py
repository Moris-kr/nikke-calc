"""캐릭터 초상화 썸네일 (보고서 HTML 인라인용) — 계산 엔진과 무관한 표시 도우미.

TS 보고서 스크립트(`images.ts`)가 표준 입력으로 요청 목록을 넘기고 base64 WebP 목록을 받는다.
파이썬 보고서 렌더러가 쓰던 Pillow 처리(위 18% 지점부터 정사각형 자르기 → LANCZOS 축소 → WebP)를
그대로 옮겨, 같은 Pillow면 바이트까지 같은 이미지가 나온다. Pillow나 파이썬이 없으면 TS 쪽이 원본
이미지를 그대로 넣고 CSS로 잘라 보여 준다(파일이 커질 뿐 보고서는 만들어진다).

    요청: [{"path": "...", "size": 150, "quality": 82, "always": false}, ...]
    응답: ["<base64>" 또는 null, ...]
"""

import base64
import io
import json
import sys

from PIL import Image


def _thumb(req: dict) -> str | None:
    try:
        img = Image.open(req["path"]).convert("RGB")
    except OSError:
        return None
    side = min(img.width, img.height)
    top = min(int(img.height * 0.18), img.height - side)
    img = img.crop((0, top, side, top + side))
    size = int(req["size"])
    if req.get("always") or side > size:
        img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="webp", quality=int(req["quality"]))
    return base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    reqs = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.stdout.write(json.dumps([_thumb(r) for r in reqs]))


if __name__ == "__main__":
    main()

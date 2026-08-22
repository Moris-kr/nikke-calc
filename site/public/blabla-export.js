/* blablalink → NIKKE 스쿼드 계산기 육성 프로필 내보내기.
 *
 * blablalink.com 탭에서 실행한다(북마클릿이 이 파일을 주입한다). 그 출처에서 돌기 때문에
 * 로그인 세션이 그대로 쓰이고 CORS도 걸리지 않는다 — 계산기 사이트에서 직접 부르면
 * blablalink API가 Access-Control-Allow-Origin을 주지 않아 브라우저가 막는다.
 *
 * 결과는 계산기의 "프로필 불러오기"가 읽는 형식(profiles/<이름>.json)으로 내려받는다.
 * 자격증명은 blablalink 안에만 있고 어디로도 전송되지 않는다.
 */
(async function () {
  var API = 'https://api.blablalink.com/api/game/proxy/';
  var NAME_CODES = 'https://moris-kr.github.io/nikke-calc/nikke-name-codes.json';
  var COMMON = {
    game_id: '29080', area_id: 'global', source: 'pc_web',
    intl_game_id: '29080', language: 'ko', env: 'prod'
  };
  var NO_ITEM = '없음';
  var CORP_TIER = 10;               // 기업 장비(T10)만 강화 단계 0~5를 갖는다
  var PARTS = [['head', '머리'], ['torso', '몸통'], ['arm', '팔'], ['leg', '다리']];
  // 오버로드 옵션 function_type → 계산기 키 (scraper/profile_fetch.py FUNC_TO_EQUIP와 같아야 한다)
  var FUNC = {
    StatAtk: 'atk_pct', IncElementDmg: 'element_bonus', StatAmmoLoad: 'max_ammo_pct',
    StatCritical: 'crit_rate', StatCriticalDamage: 'crit_dmg', StatChargeTime: 'charge_speed_pct',
    StatChargeDamage: 'charge_dmg_pct', StatAccuracyCircle: 'accuracy_pct',
    IncHurtDef: 'def_pct', StatDef: 'def_pct'
  };
  // 최대 장탄·차지 속도는 줄마다 따로 반올림된다 → 합치지 않고 줄별로 넘긴다.
  var PER_LINE = { max_ammo_pct: 1, charge_speed_pct: 1 };

  function toast(text, ok) {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:24px;transform:translateX(-50%);'
      + 'max-width:min(560px,92vw);padding:14px 18px;border-radius:10px;font:14px/1.6 system-ui,sans-serif;'
      + 'white-space:pre-line;box-shadow:0 10px 30px rgba(0,0,0,.35);'
      + (ok ? 'background:#0e3b38;color:#cfeceb;border:1px solid #45d6d0;'
            : 'background:#3b1620;color:#ffd7dd;border:1px solid #ff7787;');
    box.textContent = text;
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 12000);
  }

  function post(route, body) {
    return fetch(API + route, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Common-Params': JSON.stringify(COMMON) },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function cookieValue(key) {
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var s = parts[i].trim();
      if (s.indexOf(key + '=') === 0) return s.slice(key.length + 1);
    }
    return '';
  }

  // 프로필 URL의 openid는 base64다. API는 디코딩한 값(29080-…)을 받는다.
  function targetOpenId() {
    var raw = new URLSearchParams(location.search).get('openid');
    if (raw) {
      try {
        var decoded = atob(decodeURIComponent(raw));
        if (/^\d+-\d+$/.test(decoded)) return decoded;
      } catch (e) { /* base64가 아니면 아래로 */ }
      if (/^\d+-\d+$/.test(raw)) return raw;
    }
    // openid를 비워 보내면 로그인한 본인 계정이 온다(실측).
    return cookieValue('game_openid') || '';
  }

  function equipment(detail) {
    var out = {};
    for (var i = 0; i < PARTS.length; i += 1) {
      var api = PARTS[i][0], ko = PARTS[i][1];
      var tier = detail[api + '_equip_tier'] || 0;
      if (tier >= CORP_TIER) out[ko] = { level: detail[api + '_equip_lv'] || 0 };
      else if (tier >= 1) out[ko] = { tier: 'T' + tier };
      else out[ko] = { tier: NO_ITEM };
    }
    return out;
  }

  function equipSkills(detail, optMap) {
    var out = {};
    for (var p = 0; p < PARTS.length; p += 1) {
      var api = PARTS[p][0];
      for (var i = 1; i <= 3; i += 1) {
        var oid = String(detail[api + '_equip_option' + i + '_id'] || '');
        var opt = optMap[oid];
        if (!opt) continue;
        // 옵션 수치는 state_effects[].function_details[0]에 들어 있다
        // (function_value 2356 = 23.56%).
        var fn = (opt.function_details || [])[0];
        if (!fn) continue;
        var key = FUNC[fn.function_type];
        if (!key) continue;
        var pct = Math.abs(Number(fn.function_value || 0)) / 100;
        if (!pct) continue;
        pct = Number(pct.toFixed(2));
        if (PER_LINE[key]) { (out[key] = out[key] || []).push(pct); }
        else { out[key] = Number(((out[key] || 0) + pct).toFixed(2)); }
      }
    }
    return out;
  }

  try {
    // 빈 문자열이면 API가 로그인한 본인 계정을 준다(실측) — 그대로 보낸다.
    var openid = targetOpenId();

    var names = await (await fetch(NAME_CODES, { cache: 'no-cache' })).json();

    // 지역(area)은 계정마다 다르다 — 캐릭터가 나오는 값을 찾는다.
    var chars = null, area = null, notLogin = false;
    var areas = [83, 261, 219, 145, 81, 82, 1, 2, 3];
    for (var a = 0; a < areas.length; a += 1) {
      var r = await post('Game/GetUserCharacters', { intl_open_id: openid, nikke_area_id: areas[a] });
      if (r && r.code === 300001) { notLogin = true; break; }
      if (r && r.code === 0 && r.data && r.data.characters && r.data.characters.length) {
        chars = r.data.characters; area = areas[a]; break;
      }
    }
    if (notLogin) {
      toast('blablalink 로그인이 풀렸습니다.\n로그인한 뒤 다시 실행해 주세요.', false);
      return;
    }
    if (!chars) {
      toast('니케 정보를 공개해주세요.\n\nblablalink 설정 → 개인정보(프로필 공개) 에서\n니케 도감 공개를 켠 뒤 다시 실행해 주세요.', false);
      return;
    }

    // 상세는 60명씩 끊어 받는다.
    var codes = chars.map(function (c) { return c.name_code; });
    var details = {}, optMap = {};
    for (var i = 0; i < codes.length; i += 60) {
      var rd = await post('Game/GetUserCharacterDetails', {
        intl_open_id: openid, nikke_area_id: area, name_codes: codes.slice(i, i + 60)
      });
      var d = (rd && rd.data) || {};
      var rows = d.character_details || d.details || [];
      for (var k = 0; k < rows.length; k += 1) details[rows[k].name_code] = rows[k];
      var effects = d.state_effects || [];
      for (var e = 0; e < effects.length; e += 1) optMap[String(effects[e].id)] = effects[e];
    }

    var out = {}, skipped = 0, kept = 0;
    for (var c = 0; c < chars.length; c += 1) {
      var ch = chars[c];
      var name = names[String(ch.name_code)];
      if (!name) { skipped += 1; continue; }      // 계산기 미지원(미파싱) 캐릭터
      var det = details[ch.name_code] || {};
      var entry = {
        breakthrough: ch.grade || 0,
        core_enhancement: ch.core || 0,
        affinity: Math.max(1, det.attractive_lv || 1),
        skill_levels: {
          '1': det.skill1_lv || 1, '2': det.skill2_lv || 1, '3': det.ulti_skill_lv || 1
        },
        equipment: equipment(det),
        equip_skills: equipSkills(det, optMap)
      };
      if (det.favorite_item_lv) entry.favorite_stage = Math.min(3, det.favorite_item_lv);
      out[name] = entry;
      kept += 1;
    }

    if (!kept) {
      toast('니케 정보를 공개해주세요.\n\n데이터는 읽었지만 계산기가 아는 캐릭터가 없습니다.', false);
      return;
    }

    var profile = {
      _meta: {
        name: 'blablalink', fetched_at: new Date().toISOString(),
        source: 'blabla-export.js', roster: kept, area: area
      },
      chars: out
    };
    var blob = new Blob([JSON.stringify(profile, null, 1)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'nikke-profile.json';
    document.body.appendChild(link);
    link.click();
    link.remove();

    toast('니케 ' + kept + '명을 내려받았습니다'
      + (skipped ? ' (계산기 미지원 ' + skipped + '명 제외)' : '')
      + '.\n계산기에서 "프로필 불러오기"로 이 파일을 넣어 주세요.', true);
  } catch (err) {
    toast('가져오지 못했습니다: ' + (err && err.message ? err.message : err)
      + '\n\nblablalink에 로그인돼 있는지, 니케 정보가 공개돼 있는지 확인해 주세요.', false);
  }
})();

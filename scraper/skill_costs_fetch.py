"""Export official BlablaLink skill-upgrade costs for the site's catalog.

Run after site sync-runtime: python scraper/skill_costs_fetch.py
No account or session is used. Each array index is the starting level minus one.
"""
import concurrent.futures
import json
from pathlib import Path

import httpx
import cdn_path

ROOT = Path(__file__).resolve().parents[1]


def fetch(character):
    rid = character['resourceId']
    response = httpx.get(cdn_path.url(f'/roledata/{rid}-v2-ko.json'), timeout=45)
    response.raise_for_status()
    raw = response.json()
    skills = {}
    items = {}
    for key, field in [('1', 'skill1_cost_detail'), ('2', 'skill2_cost_detail'), ('3', 'ulti_skill_cost_detail')]:
        steps = []
        for row in raw.get(field) or []:
            if row is None:
                break
            costs = {}
            for item in row['costs']:
                if item.get('item_id'):
                    iid = str(item['item_id'])
                    costs[iid] = item['item_value']
                    items[iid] = item['name_localkey']
            steps.append(costs)
        skills[key] = steps
    return character['name'], skills, items


def main():
    catalog = json.loads((ROOT / 'site/public/catalog.json').read_text(encoding='utf-8'))
    characters, items = {}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for name, skills, labels in pool.map(fetch, [c for c in catalog if c['resourceId'] and not c['preview']]):
            characters[name] = skills
            items.update(labels)
    output = {'source': 'https://www.blablalink.com', 'items': items, 'characters': characters}
    (ROOT / 'site/src/skill-costs.json').write_text(
        json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Exported {len(characters)} characters, {len(items)} materials')


if __name__ == '__main__':
    main()

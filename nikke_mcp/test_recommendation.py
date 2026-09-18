import unittest
from copy import deepcopy
from mcp.server.mcpserver.exceptions import ToolError
from mcp import Client
from nikke_mcp.server import create_server
from nikke_mcp.browser_relay import BrowserRelay
from nikke_mcp.recommendation_evidence import evidence
from nikke_mcp.models import RecommendationScenario, data


class EvidenceTests(unittest.TestCase):
    def test_relay_rejects_inconsistent_selected_and_scores(self):
        squad = ['리타', '크라운', '헬름', '앨리스', '모더니아']
        payload = {'kind': 'recommend', 'options': {'candidates': [{'squad': squad}], 'squadCount': 1}}
        row = {'id': 0, 'squad': squad, 'status': 'evaluated', 'policy': {'recommendedEligible': True}, 'scenarios': [{'total': 10}]}
        valid = {'engineVersion': 'test', 'candidates': [row], 'selected': [row],
                 'solutions': [{'candidateIds': [0], 'scenarioTotals': [10], 'baseTotal': 10, 'maxRegret': 0}]}
        relay = BrowserRelay()
        relay._validate_result(payload, valid)
        for key, value in [('selected', [{'squad': ['other']}]), ('solutions', ['bad'])]:
            wrong = deepcopy(valid)
            wrong[key] = value
            with self.assertRaises(ToolError): relay._validate_result(payload, wrong)
        wrong = deepcopy(valid)
        wrong['solutions'][0]['scenarioTotals'] = [20]
        with self.assertRaises(ToolError): relay._validate_result(payload, wrong)

    def test_all_observed_squads_join_canonical_resource_ids(self):
        observed = evidence()
        raw = data('scraper/nikke_scraped.json')
        teams = observed['campaign']['teams'] + [t for s in observed['soloraid']['seasons'] for t in s['teams']]
        self.assertEqual(len(teams), 34)
        for team in teams:
            self.assertEqual(len(set(team['characters'])), 5)
            self.assertEqual([int(raw[n]['id']) for n in team['characters']], team['resourceIds'])
        self.assertFalse(observed['live'])

    def test_scenarios_cannot_change_account_or_accept_invalid_battle(self):
        for battle in [{'synchroLevel': 999}, {'characters': {}}, {'corePx': -1}, {'hasParts': 'yes'}]:
            with self.assertRaises(ValueError):
                RecommendationScenario(label='test', battle=battle)

    def test_recommendation_heartbeat_retains_long_job_but_has_bound(self):
        clock = [0]
        relay = BrowserRelay(clock=lambda: clock[0])
        session = relay.connect()
        job = relay.submit(session['connectionCode'], {'kind': 'recommend', 'options': {}})
        relay.poll(session['browserToken'])
        for moment in range(30, 1261, 30):
            clock[0] = moment
            relay.poll(session['browserToken'], ready=False)
            state = relay.result(session['connectionCode'], job['jobId'])
            self.assertEqual(state['status'], 'running' if moment < 1260 else 'failed')


class RecommendationProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_readonly_tools_respond(self):
        async with Client(create_server(browser_mode=True)) as client:
            result = await client.call_tool('get_recommendation_evidence', {'mode': 'campaign'})
            self.assertFalse(result.is_error)
            self.assertIn('mechanismAnalysis', result.structured_content)
            result = await client.call_tool('validate_squad_policy', {'squad': ['리타', '크라운', '헬름', '앨리스', '모더니아']})
            self.assertFalse(result.is_error)
            self.assertTrue(result.structured_content['recommendedEligible'])
            result = await client.call_tool('recommend_browser_squads', {'connection_code': '', 'candidates': [
                {'label': '검증', 'squad': ['리타', '크라운', '헬름', '앨리스', '모더니아']}]})
            self.assertTrue(result.is_error)
            self.assertIn('CONNECTION_REQUIRED', str(result.content))


if __name__ == '__main__':
    unittest.main()

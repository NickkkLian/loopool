// Builds the app page (local file + publishable page) and the n8n workflow from one source.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');
const OUT = process.argv[2] || path.join(__dirname, '..');
const SCR = __dirname;
const ENGINE = SRC('engine.js'), SCRIPT = SRC('script.js'), APP = SRC('app.js');
const CAMERA = fs.existsSync(path.join(__dirname, 'src', 'camera.js')) ? SRC('camera.js') : '';   // the table-camera page (#camera)
const HEAD = SRC('head.html');
const BODY = SRC('body.html').replace('/*__ENGINE__*/', () => ENGINE).replace('/*__SCRIPT__*/', () => SCRIPT).replace('/*__APP__*/', () => CAMERA + '\n' + APP);
const FULL = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>\n' + HEAD + '\n</head>\n<body>\n' + BODY + '\n</body>\n</html>\n';
const FRAGMENT = HEAD + '\n' + BODY + '\n';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), FULL);
fs.writeFileSync(path.join(SCR, 'loopool-fragment.html'), FRAGMENT);
if (FULL.includes('{{')) throw new Error('HTML contains {{, which n8n could treat as an expression');

// ---------- workflow ----------
let n = 0;
const uid = () => { const h = crypto.createHash('sha1').update('pool-referee-' + (n++)).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); };
const nodes = [], connections = {};
const node = (name, type, typeVersion, position, parameters, extra) => { nodes.push(Object.assign({ parameters, id: uid(), name, type, typeVersion, position }, extra || {})); return name; };
const link = (from, to, out) => { connections[from] = connections[from] || { main: [] }; const o = out || 0; while (connections[from].main.length <= o) connections[from].main.push([]); connections[from].main[o].push({ node: to, type: 'main', index: 0 }); };
let sn = 0;
const sticky = (content, position, width, height, color) => nodes.push({ parameters: { content, height, width, color }, id: uid(), name: 'Note ' + (++sn), type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position });
const ifNode = (name, pos, left, op, right) => node(name, 'n8n-nodes-base.if', 2.2, pos, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [Object.assign({ id: uid(), leftValue: left, operator: op }, right === undefined ? {} : { rightValue: right })], combinator: 'and' }, options: {} });

// ---------- the n8n workflow, laid out so each job is its own visible step ----------
const PARTS = require('./workflow-parts.js');
const fnBody = f => { const s = f.toString(); return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n+|\s+$/g, '').split('\n').map(l => l.replace(/^  /, '')).join('\n'); };
const BASE = fnBody(PARTS.baseUrlSnippet).split('\n').map(l => l).join('\n');
const codeOf = f => fnBody(f).replace('/*BASE*/', BASE.replace(/\n/g, '\n'));
const HOUSE_RULES = [
  '- Winner stays on. A table holder can win at most ' + 3 + ' games in a row while people are waiting, then the table goes to the next players.',
  '- When you are called, you have 3 minutes to check in at the table (on your phone or from the email), or the next name on the board is called.',
  '- Table 1 has the camera referee and its games are rated (Elo, K = 32). Tables 2 to 4 are not rated. A game there is called by the camera referee only if staff have a camera running over that table when it starts; otherwise players report the winner and both confirm.',
  '- The camera referee (an AI reading photos of each shot) calls a foul on its own when it is at least 60% sure. Below that, play pauses and both players vote on their phones. If they disagree, staff decide on the counter tablet. Staff can also undo any call.',
  '- 8-ball, simplified: the table is open until someone legally pots a ball, which sets solids (1-7) or stripes (9-15). On each shot you must hit a ball of your own group first, or the 8 once your group is cleared. On the break any ball may be hit first.',
  '- Fouls: the cue ball goes in a pocket (scratch), the cue ball hits nothing, or the wrong ball is hit first. After a foul the other player has ball in hand. Potting the 8 before your group is cleared, or on a foul, loses the game.',
  '- Not checked by the camera: a ball reaching a cushion after contact, double hits, and balls touched by hand. Staff decide those.',
].join('\n');

sticky(`## Loopool\nA fair queue for pool tables plus a camera referee, run by n8n.\n\n**Three ways in**\n1. **Pool API**: the app, the bar TV, the counter tablet and the camera service (\`/webhook/pool?action=...\`).\n2. **Email links**: players check in, vote on a foul or confirm a result straight from their email (\`/webhook/pool-act\`).\n3. **Ask the referee**: an AI agent answers questions about the rules and the live board (\`/webhook/pool-ask\`).\n\nAll three go through one **Referee engine** (queue, 8-ball rules, foul reviews, Elo ratings; state in this workflow's static data), then a **router** sends the answer back the right way. Messages for players go out by **Gmail**.`, [-560, -520], 700, 430, 4);
sticky(`### Optional: an external camera service → n8n\nInstead of the camera page, a vision service (like the OpenCV experiment in experiments/) can call\n\`/webhook/pool?action=shot&table=T1&event={...}\`\nwith the potted balls, the first ball hit, a confidence score and the ball positions. Below 80% confidence the engine pauses play for a player review.`, [200, -520], 520, 300, 5);

// 1. three entry points
const api = node('Pool API', 'n8n-nodes-base.webhook', 2.1, [-480, 140], { path: 'pool', responseMode: 'responseNode', options: { allowedOrigins: '*' } }, { webhookId: uid() });
const read = node('Read app request', 'n8n-nodes-base.code', 2, [-240, 140], { jsCode: codeOf(PARTS.readRequest) });
const actHook = node('Email link tapped', 'n8n-nodes-base.webhook', 2.1, [-480, 340], { path: 'pool-act', responseMode: 'responseNode', options: {} }, { webhookId: uid() });
const readAct = node('Read email link', 'n8n-nodes-base.code', 2, [-240, 340], { jsCode: codeOf(PARTS.readEmailLink) });
const askHook = node('Question from a player', 'n8n-nodes-base.webhook', 2.1, [-480, 540], { path: 'pool-ask', responseMode: 'responseNode', options: { allowedOrigins: '*' } }, { webhookId: uid() });
const readAsk = node('Read question', 'n8n-nodes-base.code', 2, [-240, 540], { jsCode: codeOf(PARTS.readQuestion) });

// 2. the engine
const engine = node('Referee engine', 'n8n-nodes-base.code', 2, [40, 340], { jsCode: `// Queue (winner stays on), check-in timers, 8-ball rules, foul reviews and Elo ratings.\n// State is kept in this workflow's static data (saved for published workflows called on the production URL).\n// For heavy traffic, swap static data for n8n Data Tables or Postgres so simultaneous requests can't overwrite each other.\n${ENGINE}\nconst req = $input.first().json;\nconst store = $getWorkflowStaticData('global');\nconst realNow = Date.now();\nlet S = store.pool ? JSON.parse(JSON.stringify(store.pool)) : null;\nlet seeded = false;\nif (!S || req.action === 'reset') { S = seedState(realNow); seeded = true; }\nconst before = JSON.stringify(S);\nconst out = handle(S, req.action, req, realNow);\nif (seeded || JSON.stringify(out.S) !== before) store.pool = out.S;\nreturn [{ json: { response: out.response, notify: out.notify, finished: out.finished, via: req.via || 'app', action: req.action, table: req.table || '', question: req.question || '', base: req.base || '' } }];` });

// 3. route the answer back the way the request came in
const cond = (val, key) => ({ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: uid(), leftValue: '={{ $json.via }}', rightValue: val, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: key });
const shotRule = { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [
  { id: uid(), leftValue: '={{ $json.via }}', rightValue: 'app', operator: { type: 'string', operation: 'equals' } },
  { id: uid(), leftValue: '={{ $json.action }}', rightValue: 'shot', operator: { type: 'string', operation: 'equals' } },
  { id: uid(), leftValue: '={{ $json.response.ok }}', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, renameOutput: true, outputKey: 'Camera scored a shot' };
const router = node('Where did it come from?', 'n8n-nodes-base.switch', 3.2, [320, 340], { rules: { values: [shotRule, cond('app', 'App or camera'), cond('email', 'Email link'), cond('ask', 'AI question'), cond('score', 'Camera photos scored')] }, options: {} });
// live AI commentary on every shot the camera scores
const shotBrief = node('Brief the shot', 'n8n-nodes-base.code', 2, [620, -200], { jsCode: codeOf(PARTS.briefShot) });
const commentator = node('AI commentator', '@n8n/n8n-nodes-langchain.agent', 3.1, [860, -200], { promptType: 'define', text: '={{ $json.facts }}', options: { systemMessage: 'You are the live commentator on the bar TV at a pool hall, speaking right after each shot.\nWrite one or two short sentences, 32 words at most, about the shot that just happened: what the shooter did, any foul and what it costs, and what it means for the game (balls left, who shoots next, ball in hand, on the 8, game over).\nUse only the facts given. Never invent spin, speed, difficulty or anything not in the facts. No markdown, no emojis, no quotation marks.', maxIterations: 1 } }, { onError: 'continueRegularOutput' });
const commentModel = node('Claude (commentator)', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, [860, 0], { model: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, options: { maxTokensToSample: 200, thinkingMode: 'disabled' } });
const saveAi = node('Save the commentary', 'n8n-nodes-base.code', 2, [1120, -200], { jsCode: codeOf(PARTS.saveCommentary) });
const replyShot = node('Reply to camera', 'n8n-nodes-base.respondToWebhook', 1.1, [1360, -200], { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: {} });
const reply = node('Reply to app', 'n8n-nodes-base.respondToWebhook', 1.1, [620, 140], { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: {} });
const page = node('Build the result page', 'n8n-nodes-base.code', 2, [620, 340], { jsCode: codeOf(PARTS.resultPage) });
const replyPage = node('Show the result page', 'n8n-nodes-base.respondToWebhook', 1.1, [860, 340], { respondWith: 'text', responseBody: '={{ $json.html }}', options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } } });
const brief = node('Brief the referee', 'n8n-nodes-base.code', 2, [620, 560], { jsCode: codeOf(PARTS.briefReferee) });
const agent = node('AI referee', '@n8n/n8n-nodes-langchain.agent', 3.1, [860, 560], { promptType: 'define', text: '={{ $json.question }}', options: { systemMessage: `=You are the friendly referee and host at Loopool, answering a player on their phone.\nAnswer in at most 3 short sentences, in plain words, without markdown. Use only the house rules and the live board below. If the answer is not there, say you don't know and suggest asking staff at the counter. Never invent players, times or rules.\n\nHOUSE RULES\n${HOUSE_RULES}\n\nLIVE BOARD\n{{ $json.brief }}`, maxIterations: 3 } }, { onError: 'continueRegularOutput' });
const model = node('Claude (n8n Gateway credits)', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, [860, 780], { model: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, options: { maxTokensToSample: 600, thinkingMode: 'disabled' } });
const replyAsk = node('Reply with the answer', 'n8n-nodes-base.respondToWebhook', 1.1, [1120, 560], { respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: true, answer: $json.output || "Sorry, I can\'t answer that right now. Ask the staff at the counter." }) }}', options: {} });

// 4. messages to players
const hasMail = ifNode('Emails to send?', [320, 760], '={{ $json.notify.length }}', { type: 'number', operation: 'gt' }, 0);
const split = node('One email per player', 'n8n-nodes-base.splitOut', 1, [560, 980], { fieldToSplitOut: 'notify', options: {} });
// Emails go out in a separate background run of this same workflow, so this run ends (and saves the
// queue) right after replying. Otherwise a tap arriving while Gmail is still sending reads an old queue.
const bg = node('Send emails in the background', 'n8n-nodes-base.executeWorkflow', 1.2, [800, 980], { source: 'database', workflowId: { __rl: true, mode: 'id', value: '={{ $workflow.id }}' }, mode: 'once', options: { waitForSubWorkflow: false } });
const bgStart = node('Background email run', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [320, 1400], { inputSource: 'passthrough' });
const write = node('Write the email', 'n8n-nodes-base.code', 2, [560, 1400], { jsCode: codeOf(PARTS.writeEmail) });
const gmail = node('Send email (Gmail)', 'n8n-nodes-base.gmail', 2.1, [800, 1400], { sendTo: '={{ $json.to }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options: { appendAttribution: false, senderName: 'Loopool' } }, { webhookId: uid() });

link(api, read); link(read, engine); link(actHook, readAct); link(readAct, engine); link(askHook, readAsk); link(readAsk, engine);
link(engine, router); link(engine, hasMail);
link(router, shotBrief, 0); link(router, reply, 1); link(router, page, 2); link(router, brief, 3);
link(shotBrief, commentator); link(commentator, saveAi); link(saveAi, replyShot);
connections[commentModel] = { ai_languageModel: [[{ node: commentator, type: 'ai_languageModel', index: 0 }]] };
link(page, replyPage); link(brief, agent); link(agent, replyAsk);
connections[model] = { ai_languageModel: [[{ node: agent, type: 'ai_languageModel', index: 0 }]] };
link(hasMail, split, 0); link(split, bg); link(bgStart, write); link(write, gmail);

// 6. Camera referee: the camera page sends photos of each shot -> Claude reads them -> a fixed 0-100 rubric -> the engine
sticky(`### Camera photos → AI referee\nThe camera screen (\`#camera\`) spots each shot by motion and posts the photos to \`/webhook/pool-score\`: before, up to 4 in-between, after, a change map, and the table's ball colours.\n**AI reads the shot** (Claude Haiku 5.5 on n8n Gateway credits; see reports/accuracy-and-cost.html) describes it; **Score the shot** turns that into a 0-100 score with a fixed rubric; the **Referee engine** applies turns, groups, fouls, winner and ratings. The after-photo is kept for the bar TV (\`/webhook/pool-frame\`).`, [-560, 1600], 900, 150, 6);
const scoreHook = node('Shot photos from the camera', 'n8n-nodes-base.webhook', 2.1, [-480, 1800], { path: 'pool-score', httpMethod: 'POST', responseMode: 'responseNode', options: { allowedOrigins: '*' } }, { webhookId: uid() });
const prep = node('Prepare the AI request', 'n8n-nodes-base.code', 2, [-240, 1800], { jsCode: codeOf(PARTS.prepareShot) });
const vision = node('AI reads the shot', '@n8n/n8n-nodes-langchain.anthropic', 1, [0, 1800], { resource: 'image', operation: 'analyze', modelId: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, text: '={{ $json.prompt }}', inputType: 'binary', binaryPropertyName: '={{ $json.imageKeys }}', simplify: false, options: { maxTokens: 7000 } }, { onError: 'continueRegularOutput' });
const scoreN = node('Score the shot', 'n8n-nodes-base.code', 2, [240, 1800], { jsCode: codeOf(PARTS.scoreShot) });
const readScored = node('Read the scored shot', 'n8n-nodes-base.code', 2, [480, 1800], { jsCode: codeOf(PARTS.readScoredShot) });
const applyCall = node('Apply the shot', 'n8n-nodes-base.httpRequest', 4.2, [720, 1800], { method: 'POST', url: '={{ $json.url }}', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.payload) }}', options: { timeout: 30000 } }, { onError: 'continueRegularOutput' });
const camReply = node('Build the camera reply', 'n8n-nodes-base.code', 2, [960, 1800], { jsCode: codeOf(PARTS.cameraReply) });
const camRespond = node('Reply to the camera page', 'n8n-nodes-base.respondToWebhook', 1.1, [1200, 1800], { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: {} });
link(scoreHook, prep); link(prep, vision); link(vision, scoreN); link(scoreN, readScored); link(readScored, applyCall); link(applyCall, camReply); link(camReply, camRespond);
// The shot is applied in its own short run: the run above waits ~15 s for the AI, and n8n saves workflow state when a
// run ends, so applying it there would overwrite whatever players and staff did during those seconds.
const applyHook = node('Scored shot to apply', 'n8n-nodes-base.webhook', 2.1, [-480, 2240], { path: 'pool-apply', httpMethod: 'POST', responseMode: 'responseNode', options: {} }, { webhookId: uid() });
const applyRead = node('Save photo, hand shot to engine', 'n8n-nodes-base.code', 2, [-240, 2240], { jsCode: codeOf(PARTS.applyShot) });
const applyRespond = node('Reply with the game result', 'n8n-nodes-base.respondToWebhook', 1.1, [620, 1160], { respondWith: 'json', responseBody: '={{ JSON.stringify({ response: $json.response }) }}', options: {} });
link(applyHook, applyRead); link(applyRead, engine);
link(router, applyRespond, 4);
const frameHook = node('Table photo', 'n8n-nodes-base.webhook', 2.1, [-480, 2020], { path: 'pool-frame', responseMode: 'responseNode', options: { allowedOrigins: '*' } }, { webhookId: uid() });
const frameLoad = node('Load the table photo', 'n8n-nodes-base.code', 2, [-240, 2020], { jsCode: codeOf(PARTS.loadFrame) });
const frameSend = node('Send the photo', 'n8n-nodes-base.respondToWebhook', 1.1, [0, 2020], { respondWith: 'binary', responseDataSource: 'automatically', options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'max-age=86400' }] } } });
link(frameHook, frameLoad); link(frameLoad, frameSend);

// 5. the app page itself
const appHook = node('Pool app page', 'n8n-nodes-base.webhook', 2.1, [-480, 1180], { path: 'pool-app', responseMode: 'responseNode', options: {} }, { webhookId: uid() });
const sendPage = node('Send the app page', 'n8n-nodes-base.respondToWebhook', 1.1, [-240, 1180], { respondWith: 'text', responseBody: FULL, options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }] } } });
link(appHook, sendPage);
sticky(`### App page\nOpening \`/webhook/pool-app\` returns the whole app: player phone (\`#phone\`), bar TV (\`#tv\`), counter tablet (\`#venue\`). The page and the API share one address, so phones need no setup: scan the QR code on the TV, join, play.`, [-560, 1340], 560, 220, 7);

const wf = { name: 'Loopool', nodes, connections, pinData: {}, settings: { executionOrder: 'v1' }, active: false, meta: { templateCredsSetupCompleted: true }, tags: [] };
fs.writeFileSync(path.join(OUT, 'pool-referee.n8n.json'), JSON.stringify(wf, null, 2));
console.log('index.html', FULL.length, 'bytes · fragment', FRAGMENT.length, '· workflow nodes', nodes.length, '· workflow bytes', JSON.stringify(wf).length);

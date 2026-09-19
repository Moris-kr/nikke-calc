import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pages=JSON.parse(readFileSync(resolve(root,'content/guides.json'),'utf8'));
const base='https://moris-kr.github.io/nikke-calc/';
const path='/nikke-calc/';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const links=pages.map(page=>`<li><a href="${path}guides/${page.slug}/">${escape(page.title)}</a><p>${escape(page.description)}</p></li>`).join('');
const style=`:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#091321;color:#e2eaf5}*{box-sizing:border-box}body{margin:0;line-height:1.85;word-break:keep-all;overflow-wrap:anywhere}header,main,footer{max-width:900px;margin:auto;padding:24px}header{border-bottom:1px solid #30445e}a{color:#99c8ff;text-underline-offset:4px}a:focus-visible{outline:3px solid #ffc875;outline-offset:5px}h1{font-size:clamp(1.65rem,4vw,2.5rem);line-height:1.35}h2{margin-top:2.2em;font-size:1.3rem}p{color:#bed0e6}nav{display:flex;gap:20px;flex-wrap:wrap}.cta{display:inline-block;background:#84bfff;color:#07172a;padding:12px 22px;border-radius:10px;font-weight:700;text-decoration:none}.intro{font-size:1.1rem}.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}.cards li{padding:20px;border:1px solid #30445e;border-radius:12px;background:#132237}.cards p{margin-bottom:0;font-size:.95rem}.cards a{font-weight:700}footer{font-size:.9rem;border-top:1px solid #30445e}.breadcrumb{font-size:.9rem}`;
function render({title,description,url,body,breadcrumb}){
 const schema={'@context':'https://schema.org','@graph':[
 {'@type':'WebPage',name:title,description,url,inLanguage:'ko',isPartOf:{'@type':'WebSite',name:'NIKKE 스쿼드 계산기',url:base}},
 {'@type':'BreadcrumbList',itemListElement:breadcrumb.map((item,i)=>({'@type':'ListItem',position:i+1,name:item.name,item:item.url}))}
 ]};
 return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | NIKKE 계산기</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="NIKKE 스쿼드 계산기"><meta property="og:locale" content="ko_KR"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${base}og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${base}og.png"><link rel="icon" href="${path}favicon.webp"><style>${style}</style><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\u003c')}</script></head><body><header><nav aria-label="주 메뉴"><a href="${path}">NIKKE 스쿼드 계산기</a><a href="${path}guides/">기능별 사용 가이드</a></nav></header><main>${body}</main><footer>승리의 여신: 니케 비공식 팬 도구입니다. 게임의 공식 서비스가 아닙니다. 계산 결과는 입력 조건과 구현 범위에 따른 추정치입니다.</footer></body></html>
`;
}
const trail=[{name:'니케 계산기',url:base},{name:'사용 가이드',url:base+'guides/'}];
const directory=resolve(root,'public/guides');mkdirSync(directory,{recursive:true});
writeFileSync(resolve(directory,'index.html'),render({title:'니케 계산기 기능별 사용 가이드',description:'니케 딜 계산·육성효율·오버로드 옵작·스킬 재료·픽업 연표·레이드 덱 비교·MCP 연결의 사용 방법을 확인하세요.',url:base+'guides/',breadcrumb:trail,body:`<h1>니케 계산기 기능별 사용 가이드</h1><p class="intro">승리의 여신 니케(NIKKE)의 덱과 육성을 비교할 때 필요한 기능을 골라 보세요. 각 가이드에서 사용 방법을 읽고 계산기로 바로 이동할 수 있습니다.</p><ul class="cards">${links}</ul>`}));
for(const page of pages){
 const dir=resolve(directory,page.slug);mkdirSync(dir,{recursive:true});
 const url=base+'guides/'+page.slug+'/';
 writeFileSync(resolve(dir,'index.html'),render({...page,url,breadcrumb:[...trail,{name:page.title,url}],body:`<p class="breadcrumb"><a href="${path}guides/">사용 가이드</a> / ${escape(page.title)}</p><h1>${escape(page.title)}</h1><p class="intro">${escape(page.description)}</p><a class="cta" href="${path}#${page.route}">관련 기능 열기</a>${page.sections.map(section=>`<section><h2>${escape(section.title)}</h2><p>${escape(section.text)}</p></section>`).join('')}<h2>다른 기능도 살펴보기</h2><ul>${pages.filter(other=>other.slug!==page.slug).map(other=>`<li><a href="${path}guides/${other.slug}/">${escape(other.title)}</a></li>`).join('')}</ul>`}));
}
const urls=[base,base+'guides/',...pages.map(page=>base+'guides/'+page.slug+'/')];
writeFileSync(resolve(root,'public/sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url=>`  <url><loc>${escape(url)}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`Built ${pages.length+1} public guide pages and sitemap.`);

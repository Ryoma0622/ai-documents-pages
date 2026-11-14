import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const app=resolve(fileURLToPath(new URL('..',import.meta.url))),repo=resolve(app,'../..');
const source=join(repo,'researches/2026/_presentation-qa.md'),asset=join(repo,'researches/2026/assets/_presentation-qa.presentation');
let browser,server;
try{
  await mkdir(asset,{recursive:true});
  await writeFile(source,'---\nexplainer: true\nhybridMarkdown: 1\nid: presentation-qa\nsummary: 合成データによるプレゼン検証\npublished: "2026-11-15"\nlang: ja\ntags: [test]\n---\n# 保存と再開\n\n```presentation\nsrc: ./assets/_presentation-qa.presentation/presentation.json\ntitle: 保存と再開\n```\n\n:::details{summary="プレゼン原稿" open="false"}\n依頼を保存し、同じ仕事へ戻ります。\n:::\n');
  await writeFile(join(asset,'presentation.json'),JSON.stringify({version:1,title:'保存と再開',mode:'script',deck:'slides.html',script:'script.txt',usage:'usage.json',slides:[{title:'保存',script:'依頼を保存します。'},{title:'再開',script:'同じ仕事へ戻ります。'}]}));
  await writeFile(join(asset,'slides.html'),'<!doctype html><html lang="ja"><title>保存と再開</title><h1>保存と再開</h1></html>');
  await writeFile(join(asset,'script.txt'),'依頼を保存し、同じ仕事へ戻ります。');
  await writeFile(join(asset,'usage.json'),JSON.stringify({stages:[],note:'合成データ。API生成なし。'}));
  execFileSync('npm',['run','build'],{cwd:app,stdio:'pipe'});
  const prefix='/ai-documents-pages/',dist=join(app,'dist');
  server=createServer(async(req,res)=>{try{const relative=decodeURIComponent(new URL(req.url,'http://test').pathname).slice(prefix.length)||'index.html';const file=resolve(dist,relative);if(!file.startsWith(dist+'/'))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.md':'text/plain','.txt':'text/plain'})[extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:320,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?report=presentation-qa`);
  await page.locator('.presentation-current p').waitFor();
  assert.equal(await page.locator('.presentation-current p').textContent(),'依頼を保存します。');
  await page.getByRole('button',{name:'次のスライド',exact:true}).click();
  assert.equal(await page.locator('.presentation-current p').textContent(),'同じ仕事へ戻ります。');
  assert.equal(await page.locator('.presentation-deck').getAttribute('sandbox'),'allow-scripts');
  assert.equal(await page.locator('.presentation-toolbar').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: TypeScript HMD manifest export, shared player, scripts, navigation, 320px controls and iframe isolation');
}finally{
  await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  await rm(source,{force:true});await rm(asset,{recursive:true,force:true});
}

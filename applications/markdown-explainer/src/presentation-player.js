/* Shared HTML / Markdown / private-book presentation player and job recovery. */
(() => {
  'use strict';
  const config=window.EXPLAINER_PRESENTATIONS||window.EXPLAINER_REPORT_AUDIO||{};
  const base=config.apiBase||'';
  const styleURL=document.currentScript?.dataset.presentationStyles||base+'/presentations/presentation.css';
  const iconPaths={slides:'M3 3h18v14H3zM8 22l4-5 4 5M12 3V1',prev:'m15 6-6 6 6 6',next:'m9 6 6 6-6 6',close:'m6 6 12 12M6 18 18 6',expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',video:'m9 5 12 7-12 7z',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2'};
  const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.innerHTML=`<path d="${iconPaths[name]}"/>`;return svg;};
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function button(label,name,onClick,text=false){const node=el('button','presentation-button');node.type='button';node.title=label;node.setAttribute('aria-label',label);node.append(icon(name));if(text)node.append(el('span','',label));node.onclick=onClick;return node;}
  function css(doc){if(doc.querySelector('[data-presentation-css]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href=styleURL;link.dataset.presentationCss='';doc.head.append(link);}
  css(document);
  async function request(url,options){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw Error(data.detail||'プレゼンを読み込めませんでした。');return data;}
  function safeAsset(path,url){if(typeof path!=='string'||!path||/^(?:[a-z]+:|\/|\\)/i.test(path)||path.split('/').includes('..')||path.includes('\\'))throw Error('資料のファイル参照が不正です。');const result=new URL(path,url);if(result.origin!==location.origin||!result.pathname.startsWith(new URL('.',url).pathname))throw Error('資料の保存先が不正です。');return result.href;}
  const time=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
  const mounted=new Map();
  async function mount(figure,url){
    url=new URL(url,document.baseURI).href;
    if(new URL(url).origin!==location.origin)throw Error('プレゼンは同じサイトの資料を指定してください。');
    const data=await request(url);
    if(data.version!==1||!Array.isArray(data.slides)||data.slides.length<1||data.slides.length>60||data.slides.some(s=>typeof s.title!=='string'||typeof s.script!=='string'))throw Error('プレゼンの形式が不正です。');
    const signature=JSON.stringify([url,data.mode,data.video,data.slides]);if(mounted.get(figure)===signature)return;
    mounted.set(figure,signature);figure.querySelector('video')?.pause();figure.replaceChildren();figure.dataset.component='presentation';figure.classList.add('report-presentation');
    const fallback=figure.nextElementSibling;if(fallback?.matches('[data-presentation-script-fallback],[data-component=details]'))fallback.hidden=true;
    const heading=el('header','presentation-heading');heading.append(icon('slides'),el('strong','','プレゼン'),el('span','presentation-meta',`${data.slides.length}枚${data.duration_seconds?' · '+time(data.duration_seconds):' · 原稿付き'}`));figure.append(heading);
    const frame=el('iframe','presentation-deck');frame.title=data.title;frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.src=safeAsset(data.deck,url);
    const stage=el('div','presentation-stage');stage.append(frame);figure.append(stage);
    let video=null;
    if(data.mode==='audio'&&data.video){video=el('video','presentation-video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=safeAsset(data.video,url);if(data.captions){const track=el('track');track.kind='captions';track.srclang='ja';track.label='日本語原稿';track.src=safeAsset(data.captions,url);video.append(track);}stage.append(video);frame.hidden=true;}
    const toolbar=el('div','presentation-toolbar');const position=el('span','presentation-position');position.setAttribute('role','status');
    const current=el('section','presentation-current');current.setAttribute('aria-label','現在のスライドの原稿');const title=el('h3'),script=el('p');current.append(title,script);
    const all=el('details','presentation-all-script');all.append(el('summary','','原稿一覧'));const list=el('ol');all.append(list);
    let index=0;
    const key='presentation:'+url;let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
    function persist(){try{localStorage.setItem(key,JSON.stringify({index,time:video?.currentTime||0}));}catch{}}
    const theme=()=>document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
    function paint(i,seek=false){
      if(!Number.isInteger(i)||i<0||i>=data.slides.length)return;index=i;const slide=data.slides[i];
      title.textContent=`${i+1}. ${slide.title}`;script.textContent=slide.script;position.textContent=`${i+1} / ${data.slides.length}`;
      previous.disabled=i===0;next.disabled=i===data.slides.length-1;
      [...list.children].forEach((item,n)=>{item.classList.toggle('is-current',n===i);item.querySelector('button').setAttribute('aria-current',n===i?'step':'false');});
      frame.contentWindow?.postMessage({type:'presentation-slide',index:i,theme:theme()},'*');
      if(seek&&video&&Number.isFinite(slide.start))video.currentTime=slide.start;
      persist();
    }
    const previous=button('前のスライド','prev',()=>paint(index-1,true)),next=button('次のスライド','next',()=>paint(index+1,true));toolbar.append(previous,position,next);
    if(video){const toggle=button('スライド表示','slides',()=>{frame.hidden=!frame.hidden;video.hidden=!video.hidden;toggle.setAttribute('aria-label',frame.hidden?'スライド表示':'動画表示');toggle.title=toggle.getAttribute('aria-label');paint(index);});toolbar.append(toggle);video.addEventListener('timeupdate',()=>{const active=data.slides.findIndex(s=>video.currentTime>=s.start&&video.currentTime<s.end);if(active>=0&&active!==index)paint(active);persist();});video.addEventListener('loadedmetadata',()=>{if(Number.isFinite(saved.time)&&saved.time>0&&saved.time<video.duration)video.currentTime=saved.time;});video.addEventListener('play',()=>{for(const other of document.querySelectorAll('video,audio'))if(other!==video)other.pause();});}
    toolbar.append(button('全画面表示','expand',()=>{if(figure.requestFullscreen)void figure.requestFullscreen();}));
    const downloads=el('div','presentation-downloads');downloads.setAttribute('aria-label','資料を開く');
    for(const [file,label,short] of [[data.deck,'スライドを開く','HTML'],[data.script,'原稿を開く','原稿'],[data.video,'動画をダウンロード','MP4']]){if(!file)continue;const link=el('a','presentation-button');link.href=safeAsset(file,url);link.title=label;link.setAttribute('aria-label',label);link.target='_blank';link.rel='noopener';link.append(icon('download'),el('span','',short));downloads.append(link);}
    figure.append(toolbar,current,all,downloads);
    data.slides.forEach((slide,i)=>{const item=el('li');const jump=button(`${i+1}. ${slide.title}${Number.isFinite(slide.start)?' · '+time(slide.start):''}`,'slides',()=>paint(i,true),true);item.append(jump,el('p','',slide.script));list.append(item);});
    const costs=el('details','presentation-usage');costs.append(el('summary','','生成コスト・利用量'));figure.append(costs);
    if(data.usage){try{const usageURL=safeAsset(data.usage,url),usage=await request(usageURL);const records=el('div','presentation-usage-records');
      for(const row of usage.stages||[]){const record=el('section');record.append(el('strong','',row.stage||'生成'));const metadata=[row.model,row.tier,row.duration_seconds?time(row.duration_seconds):null].filter(Boolean).join(' · ');record.append(el('p','',metadata));
        const raw=row.usage||{};const tokens=row.input_tokens??raw.input_tokens??raw.prompt_tokens;const output=row.output_tokens??raw.output_tokens??raw.completion_tokens;const cached=row.cached_tokens??raw.cached_input_tokens??raw.cached_tokens;
        if(tokens!==undefined||output!==undefined)record.append(el('p','',`入力 ${tokens??'不明'} / 出力 ${output??'不明'} / キャッシュ ${cached??'不明'}`));
        if(typeof raw.tokens==='string')record.append(el('p','',raw.tokens));
        const amount=row.cost_usd??raw.cost_usd??raw.estimated_cost_usd??raw.cost;
        const kind=row.cost_kind==='reported'?'提供元の報告値':row.cost_kind==='subscription-allowance-estimate'?'契約枠消費の概算':row.cost_kind==='no-new-api-call'?'今回のAPI呼出しなし':'API料金換算の概算';
        record.append(el('p','',typeof amount==='number'?`${kind}：${amount.toFixed(6)} USD`:'費用：未取得・不明'));if(row.note)record.append(el('p','',row.note));records.append(record);}
      costs.append(records,el('p','presentation-note',usage.note||'未取得の利用量・費用は不明です。'));const details=el('details');details.append(el('summary','','詳細記録'));const pre=el('pre');pre.textContent=JSON.stringify(usage,null,2);details.append(pre);const link=el('a','','利用記録JSONを開く');link.href=usageURL;link.target='_blank';link.rel='noopener';costs.append(details,link);
    }catch(error){costs.append(el('p','',error.message));}}
    frame.addEventListener('load',()=>paint(index));addEventListener('explainer-theme-change',()=>paint(index));
    addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='presentation-position'&&Number.isInteger(event.data.index)&&event.data.index!==index)paint(event.data.index);});
    paint(Number.isInteger(saved.index)?Math.min(Math.max(saved.index,0),data.slides.length-1):0);
  }
  function enhance(){for(const figure of document.querySelectorAll('[data-presentation-src]'))void mount(figure,figure.dataset.presentationSrc).catch(error=>figure.append(el('p','presentation-error',error.message)));}
  addEventListener('explainer-presentations-refresh',enhance);enhance();
  if(!config.id&&!config.slug)return;
  const slug=config.slug||(config.format==='markdown'?'docs':config.id.replace(/^html:/,'')),contextId=config.context_id||(config.format==='markdown'?'doc:'+config.id.replace(/^markdown:/,''):null);
  const query=new URLSearchParams({slug});if(contextId)query.set('context_id',contextId);
  let state=null,timer=null,polling=false,autoFigure=null;
  const dock=window.ExplainerDock,host=dock?.hostDocument()||document;css(host);
  const trigger=button('プレゼン作成','slides',()=>{dialog.showModal();void refresh();},true);trigger.id='report-presentation-generate';
  if(dock)dock.mountMenuItem(trigger,86);else(config.menu||host.querySelector('[data-book-presentation-menu]')||document.body).append(trigger);
  const dialog=host.createElement('dialog');dialog.className='presentation-dialog';dialog.setAttribute('aria-label','プレゼン作成');
  dialog.innerHTML='<form><header><h2>プレゼン作成</h2></header><fieldset><legend>出力</legend><label><input type="radio" name="mode" value="script" checked>スライド＋原稿</label><label><input type="radio" name="mode" value="audio">スライド＋原稿＋音声・動画</label></fieldset><label>スライド枚数<input name="slides" type="number" min="3" max="40" value="12"></label><label>対象者・説明の希望<textarea name="instructions" rows="3" maxlength="5000"></textarea></label><p class="presentation-note">構成・原稿の生成にモデルの利用枠を使います。音声・動画を選ぶとGemini TTS（Flex）の利用料が加わります。利用量と費用は完成資料の生成詳細に記録します。</p><p role="status" aria-live="polite"></p><p class="presentation-note">画面を閉じても生成は続きます。サーバー再起動時は保存済み結果を保持して中断を表示します。</p><footer><button type="button" data-close aria-label="閉じる" title="閉じる"></button><button type="submit">作成する</button></footer></form>';
  const close=dialog.querySelector('[data-close]');close.append(icon('close'));close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>trigger.focus());host.body.append(dialog);
  const status=dialog.querySelector('[role=status]'),submit=dialog.querySelector('[type=submit]');
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const mode=dialog.querySelector('[name=mode]:checked').value;await request(base+'/api/presentations/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,context_id:contextId,mode,slides:Number(dialog.querySelector('[name=slides]').value),instructions:dialog.querySelector('[name=instructions]').value})});await refresh();}catch(error){status.textContent=error.message;submit.disabled=false;}};
  async function refresh(){
    clearTimeout(timer);if(polling||document.hidden||!navigator.onLine)return;polling=true;
    try{state=await request(base+'/api/presentations/source?'+query);const running=['queued','running'].includes(state.job?.status);submit.disabled=running;trigger.dataset.running=String(running);
      status.textContent=running?(state.job.progress?.stage||'生成中です。'):state.job?.status==='failed'?state.job.error:state.available?(state.stale?'元資料が更新されています。保存済みプレゼンを表示しています。':'プレゼンは作成済みです。'):'';
      if(state.available){if(!autoFigure){autoFigure=document.querySelector('[data-component=presentation]');if(!autoFigure){autoFigure=el('figure','report-presentation');const heading=document.querySelector('h1');if(heading)heading.after(autoFigure);else(document.querySelector('main')||document.body).prepend(autoFigure);}}await mount(autoFigure,base+state.manifest_url);}
      if(running)timer=setTimeout(refresh,2500);
    }catch(error){status.textContent=error.message;}finally{polling=false;}
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else void refresh();});addEventListener('online',()=>void refresh());addEventListener('pagehide',()=>{clearTimeout(timer);if(trigger.ownerDocument!==document)trigger.remove();dialog.remove();});
  void refresh();
})();

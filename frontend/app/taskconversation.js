/* A task-local conversation card. Rendered words come from the pending brief; no inferred progress meter. */
'use strict';
const TaskConversation = (() => {
  /* READING ORDER (Andrew 2026-10-13: "easy to comprehend and fluid"): who asks · the question (three lines, the whole of it
     one tap away) · starting points that toggle into the answer · the answer box and its send key · the reason, the
     understanding and the draft folded under it — the same order as the choice card and the group card. */
  function mount(host,q,send) {
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
    const card=el('section','task-conversation'); card.setAttribute('aria-label','Shape this task');
    card.appendChild(el('div','tc-caption',q.asker ? (q.asker+' asks').toUpperCase() : 'LET’S SHAPE THIS'));
    const question=el('h4','tc-question',q.question);card.appendChild(question);
    const whole=el('button','tc-whole','▸ Show the whole question');whole.type='button';
    whole.onclick=()=>{const open=!card.classList.contains('tc-open');card.classList.toggle('tc-open',open);whole.textContent=open?'▾ Show less':'▸ Show the whole question';};
    card.appendChild(whole);
    // the key shows exactly while the question is clamped: re-measured whenever COMMS changes size (width, TEXT SIZE, shown
    // after being hidden); a question that cannot be measured (hidden) keeps its key
    const fit=()=>{if(card.classList.contains('tc-open')||!question.isConnected)return;whole.hidden=question.clientHeight>0&&question.scrollHeight<=question.clientHeight+2;};
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>requestAnimationFrame(fit)).observe(question);
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(fit);
    // starting points: a tap adds that line to the answer, a second tap takes it out (✓ = it is in the answer)
    const options=el('div','tc-shortcuts');
    const lineAt=(option)=>input.value.split('\n').findIndex(line=>line.trim()===option);
    function syncShortcuts(){for(const b of options.children){const on=lineAt(b._option)>=0;b.setAttribute('aria-pressed',on?'true':'false');b.textContent=(on?'✓ ':'')+b._option;}}
    for(const option of (q.options||[]).slice(0,6)) {
      const b=el('button','consent-btn tc-shortcut',option);b.type='button';b._option=option;
      b.onclick=()=>{
        const lines=input.value.split('\n'),at=lineAt(option);
        if(at>=0){lines.splice(at,1);input.value=lines.join('\n').replace(/^\n+|\n+$/g,'');}
        else {
          const next=input.value.trim() ? input.value.trim()+'\n'+option : option;
          if(next.length>input.maxLength){feedback.textContent='Your answer is full. Edit it before adding another starting point.';return;}
          input.value=next;
        }
        refresh();input.focus();
      };
      options.appendChild(b);
    }
    // one hint line, under the keys it explains (the keyboard tip lives in the box's placeholder)
    const hint=el('div','tc-hint','Tap one to add it to your answer below, then edit and send.');
    if(options.children.length) {card.appendChild(options);card.appendChild(hint);}
    const label=el('label','tc-answer-label','Your answer');
    const input=el('textarea','tc-answer');input.rows=3;input.maxLength=3800;
    input.setAttribute('aria-label','Your answer');input.placeholder='Describe it in your own words. Rough notes are fine. Enter sends · Shift + Enter adds a line.';
    label.appendChild(input);card.appendChild(label);
    const actions=el('div','tc-actions'), submit=el('button','consent-btn primary','Send answer'), skip=el('button','consent-btn tc-skip','Use your judgment');
    submit.type=skip.type='button';actions.appendChild(submit);actions.appendChild(skip);card.appendChild(actions);
    const feedback=el('div','tc-feedback');feedback.setAttribute('role','status');card.appendChild(feedback);
    // the question leads; the model's reasoning, its understanding and its draft are one tap away, never a wall above the answer
    const fold=(cls,label,body)=>{const d=el('details',cls);d.appendChild(el('summary','',label));d.appendChild(body);return d;};
    if(q.reason) card.appendChild(fold('tc-why',q.asker ? 'Why '+q.asker+' is asking' : 'Why this matters',el('p','tc-reason',q.reason)));
    const cx=q.context;
    if(cx && ((cx.facts||[]).length || (cx.assumptions||[]).length || (cx.unknowns||[]).length)) {
      const details=el('details','tc-understanding');
      details.appendChild(el('summary','','My understanding so far · open to correct me'));
      for(const f of cx.facts||[]) {
        const item=el('div','tc-fact');item.appendChild(el('span','tc-dimension',f.dimension));
        item.appendChild(el('p','',f.text));
        item.appendChild(el('blockquote','tc-quote','You said: “'+f.quote+'”'));details.appendChild(item);
      }
      for(const [field,label] of [['assumptions','I’m assuming'],['unknowns','Still unclear']]) {
        if(!(cx[field]||[]).length)continue;
        details.appendChild(el('div','tc-dimension',label));
        const list=el('ul','');for(const text of cx[field])list.appendChild(el('li','',text));details.appendChild(list);
      }
      if(cx.nextStep) details.appendChild(el('p','tc-next','Next useful step: '+cx.nextStep));
      card.appendChild(details);
    }
    if(q.sample) {
      const sample=el('div','tc-sample');sample.appendChild(el('div','tc-sample-text',q.sample));
      card.appendChild(fold('tc-draft',q.asker ? 'See the draft '+q.asker+' suggests' : 'See the draft starting point',sample));
    }
    let busy=false,done=false;
    function refresh(){submit.disabled=busy||done||!input.value.trim();skip.disabled=busy||done;input.disabled=busy||done;for(const b of options.children)b.disabled=busy||done;syncShortcuts();}
    async function answer(delegated) {
      if(busy||done)return false;
      const typed=input.value.trim();
      const text=delegated ? (typed ? typed+'\nUse your judgment for the remaining choices.' : 'use your judgment') : typed;
      if(!text)return false;
      busy=true;feedback.textContent='Sending your answer…';refresh();
      try {
        const accepted=await send(text);
        if(done)return false;   // settled on another surface while this send was in flight: that outcome stands
        if(accepted===false)throw Error('This question is no longer waiting. Your text is kept here; send it in COMMS to continue.');
        done=true;feedback.textContent='Answer sent';
        options.remove();label.remove();actions.remove();hint.remove();
        whole.remove();card.classList.add('tc-answered');card.setAttribute('aria-label','Shared task context');
        const receipt=el('details','tc-receipt');receipt.appendChild(el('summary','','You answered: '+text.slice(0,100)+(text.length>100?'…':'')));
        receipt.appendChild(el('p','tc-answer-sent',text));card.appendChild(receipt);
        return true;
      }catch(e){if(!done)feedback.textContent=e.message||'Could not send. Your text is kept here; try again.';return false;}
      finally{busy=false;refresh();}
    }
    input.addEventListener('input',refresh);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();answer(false);}});
    submit.onclick=()=>answer(false);skip.onclick=()=>answer(true);
    // submit(text): the COMMS composer answers this card when the Commander types the reply there (chat.js askAnswerers)
    const submitText=async text=>{if(done||busy)return false;input.value=String(text||'');refresh();return answer(false);};
    // settled somewhere else (the phone, a timeout, a stop): the card says so and stops taking input; the question stays
    function settle(text){
      if(done)return false;
      done=true;feedback.textContent=text||'Answered';
      options.remove();hint.remove();label.remove();actions.remove();
      card.classList.add('tc-settled');refresh();return true;
    }
    refresh();host.appendChild(card);return {card,input,submit:submitText,settle,isDone:()=>done};
  }
  return {mount};
})();
if(typeof module!=='undefined'&&module.exports)module.exports={TaskConversation};

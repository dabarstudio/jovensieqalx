/* Ponte: oferece ao site a mesma interface (db, user, assets) usando o Supabase. */
(function(){
  var C=window.JOVENS_CFG||{};
  if(!C.url||!C.key||!window.supabase){console.warn('Supabase não configurado');return}
  var sb=window.supabase.createClient(C.url,C.key,{auth:{persistSession:true,autoRefreshToken:true}});
  window.sbJovens=sb;
  var sessao=null;
  var idInicial; // undefined até a sessão inicial ser lida
  var pronto=sb.auth.getSession().then(function(r){sessao=r.data&&r.data.session||null;idInicial=sessao&&sessao.user?sessao.user.id:null;return sessao});
  var recarregando=false;
  sb.auth.onAuthStateChange(function(ev,s){sessao=s;
    if(ev==='PASSWORD_RECOVERY'){window.dispatchEvent(new CustomEvent('jovens-recuperar'));return}
    if(idInicial===undefined||recarregando)return;
    var agora=s&&s.user?s.user.id:null;
    if(agora!==idInicial&&(ev==='SIGNED_IN'||ev==='SIGNED_OUT')){recarregando=true;idInicial=agora;setTimeout(function(){location.reload()},80)}});

  function colecaoDe(path){var p=path.split('/');p.pop();return p.join('/')}
  function novoId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
  function snapDoc(row){return {exists:!!row,id:row?row.path.split('/').pop():null,data:function(){return row?row.data:undefined}}}
  function snapCol(rows){return {docs:rows.map(function(r){return {id:r.path.split('/').pop(),data:function(){return r.data}}})}}

  var ouvintes=[];
  function avisar(col,path){ouvintes.forEach(function(o){if(o.tipo==='col'?o.col===col:o.path===path)o.agendar()})}
  function ouvinte(o){
    var t=null;o.agendar=function(){clearTimeout(t);t=setTimeout(o.rodar,120)};
    ouvintes.push(o);o.rodar();
    return function(){var i=ouvintes.indexOf(o);if(i>=0)ouvintes.splice(i,1)}}

  async function lerCol(col,ordem,limite){var q=sb.from('docs').select('path,data').eq('colecao',col);
    if(ordem)q=q.order('data->>'+ordem.campo,{ascending:ordem.dir!=='desc'});
    q=q.limit(limite||1000);var r=await q;if(r.error)throw r.error;return r.data||[]}
  async function lerDoc(path){var r=await sb.from('docs').select('path,data').eq('path',path).maybeSingle();if(r.error)throw r.error;return r.data}
  async function gravar(path,data){var r=await sb.from('docs').upsert({path:path,colecao:colecaoDe(path),data:data,atualizado:new Date().toISOString()});if(r.error)throw r.error;avisar(colecaoDe(path),path)}
  async function apagar(path){var r=await sb.from('docs').delete().eq('path',path);if(r.error)throw r.error;avisar(colecaoDe(path),path)}

  function consulta(col,ordem,limite){return {
    orderBy:function(c,d){return consulta(col,{campo:c,dir:d},limite)},
    limit:function(n){return consulta(col,ordem,n)},
    add:async function(data){var id=novoId();await gravar(col+'/'+id,data);return {id:id}},
    onSnapshot:function(ok,erro){return ouvinte({tipo:'col',col:col,rodar:function(){lerCol(col,ordem,limite).then(function(rows){ok(snapCol(rows))},function(e){erro&&erro(e)})}})}}}
  var db={
    collection:function(col){return consulta(col,null,null)},
    doc:function(path){return {
      set:function(data){return gravar(path,data)},
      delete:function(){return apagar(path)},
      get:async function(){return snapDoc(await lerDoc(path))},
      onSnapshot:function(ok,erro){return ouvinte({tipo:'doc',path:path,rodar:function(){lerDoc(path).then(function(r){ok(snapDoc(r))},function(e){erro&&erro(e)})}})}}}};

  // tempo real: qualquer alteração na tabela atualiza quem está ouvindo aquela coleção
  sb.channel('docs-mudancas').on('postgres_changes',{event:'*',schema:'public',table:'docs'},function(p){var r=p.new&&p.new.path?p.new:p.old;if(r&&r.path)avisar(r.colecao||colecaoDe(r.path),r.path)}).subscribe();
  setInterval(function(){ouvintes.forEach(function(o){o.agendar()})},90000);

  var adminCache=null;
  var user={
    id:async function(){await pronto;return sessao&&sessao.user?sessao.user.id:null},
    email:async function(){await pronto;return sessao&&sessao.user?sessao.user.email:null},
    canEdit:async function(){await pronto;if(!sessao)return false;if(adminCache!==null)return adminCache;var r=await sb.rpc('eh_admin');adminCache=!r.error&&r.data===true;return adminCache},
    can:async function(){await pronto;return !!sessao},
    deJovem:async function(){await pronto;return sessao&&sessao.user&&sessao.user.user_metadata?sessao.user.user_metadata.deJovem||'':''},
    ehDono:async function(){await pronto;if(!sessao)return false;var r=await sb.rpc('eh_dono');return !r.error&&r.data===true},
    tipo:async function(){await pronto;return sessao&&sessao.user&&sessao.user.user_metadata?sessao.user.user_metadata.tipo||'':''}};

  var assets={upload:async function(file){var ext=(file.name&&file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    var caminho='perfis/'+novoId()+'.'+ext;var r=await sb.storage.from('fotos').upload(caminho,file,{upsert:false,contentType:file.type||'image/jpeg'});if(r.error)throw r.error;return {id:'sb:'+caminho}}};

  window.jovensFotos={subir:async function(dataURL,pasta,uid){var b=await (await fetch(dataURL)).blob();var caminho=pasta+'/'+uid+'/'+novoId()+'.jpg';
    var r=await sb.storage.from('fotos').upload(caminho,b,{contentType:'image/jpeg',cacheControl:'31536000'});if(r.error)throw r.error;return sb.storage.from('fotos').getPublicUrl(caminho).data.publicUrl}};
  window.fotoDe=function(id){if(!id)return null;if(id.indexOf('local:')===0)return 'fotos/'+id.slice(6);
    if(id.indexOf('sb:')===0)return sb.storage.from('fotos').getPublicUrl(id.slice(3)).data.publicUrl;return null};

  window.claude={use:async function(nome){if(nome==='db')return db;if(nome==='user')return user;if(nome==='assets')return assets;return null}};

  // ---------- conta ----------
  window.jovensConta={
    entrar:function(email,senha){return sb.auth.signInWithPassword({email:email,password:senha})},
    criar:function(email,senha,tipo,deJovem){return sb.auth.signUp({email:email,password:senha,options:{emailRedirectTo:location.origin+location.pathname,data:{tipo:tipo||'',deJovem:deJovem||''}}})},
    sair:function(){return sb.auth.signOut()},
    esqueci:function(email){return sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname+'#perfil'})},
    novaSenha:function(senha){return sb.auth.updateUser({password:senha})},
    sessao:function(){return pronto}};
})();

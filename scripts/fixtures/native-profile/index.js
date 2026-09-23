export function register(_app, { events }) {
  events.on("session:created", async ({ context }) => {
    await context.route("https://storage.test/**", async (route) => {
      const mode = new URL(route.request().url()).searchParams.get("mode");
      if (!["write", "read"].includes(mode)) return route.abort();
      const body = `<!doctype html><title>waiting</title><main>waiting</main><script>(async()=>{try{if(localStorage.getItem('synthetic-migration')!=='preserved')throw Error('local_storage');if(!document.cookie.includes('synthetic-session=preserved'))throw Error('cookie');const db=await new Promise((ok,no)=>{const r=indexedDB.open('api-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});let result;if('${mode}'==='write'){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await new Promise((ok,no)=>{const t=db.transaction('keys','readwrite');t.objectStore('keys').put(key,'key');t.oncomplete=ok;t.onerror=()=>no(t.error)});result='synthetic_key_written'}else{const key=await new Promise((ok,no)=>{const r=db.transaction('keys').objectStore('keys').get('key');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});if(!(key instanceof CryptoKey)||key.extractable)throw Error('restore');const iv=crypto.getRandomValues(new Uint8Array(12));const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new Uint8Array([1,2,3]));const p=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,c);if(new Uint8Array(p).join(',')!=='1,2,3')throw Error('roundtrip');result='synthetic_key_restored_nonextractable_roundtrip'}db.close();document.querySelector('main').textContent=result;document.title=result}catch(error){document.querySelector('main').textContent='synthetic_failed_'+error.message;document.title='synthetic_failed'}})()</script>`;
      await route.fulfill({ contentType: "text/html", body });
    });
  });
}

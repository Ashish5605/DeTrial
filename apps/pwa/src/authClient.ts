let csrf='';
export function setCsrf(value=''){csrf=value;}
export function csrfToken(){return csrf;}
export async function authFetch(input:RequestInfo|URL,init:RequestInit={}){const headers=new Headers(init.headers);if((init.method||'GET').toUpperCase()!=='GET'&&csrf)headers.set('X-CSRF-Token',csrf);const res=await window.fetch(input,{...init,headers,credentials:'same-origin'});if(res.status===401&&!String(input).includes('/api/auth/'))window.dispatchEvent(new Event('decisiontrail:expired'));return res;}
export async function api(url:string,body?:any){const res=await authFetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});const value=await res.json();if(!res.ok)throw Object.assign(new Error(value.error||'Request could not be completed.'),{result:value});return value;}
export function clearPrivateCache(){for(const key of Object.keys(localStorage))if(key.startsWith('decisiontrail:'))localStorage.removeItem(key);}
export function download(name:string,value:any,type='application/json'){const text=typeof value==='string'?value:JSON.stringify(value,null,2),url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

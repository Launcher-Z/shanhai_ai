/* 手动上传与下载共用会话令牌；不自动上传本地实验。可供外层札记和同源iframe调用。 */
(function () {
  async function request(url, body) {
    const token = (window.parent.document.querySelector('meta[name="csrf-token"]') || document.querySelector('meta[name="csrf-token"]'))?.content || '';
    let response;
    try {response=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)})});}
    catch {throw Error('连接失败，请检查网络后重试。');}
    const data=await response.json().catch(()=>{throw Error('服务暂时未能返回数据，请稍后重试。');});
    if(!response.ok)throw Error(data.error||'操作未完成，请重试。');
    return data;
  }
  window.HandwritingAPI={request};
})();

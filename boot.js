    if (window.location.hostname === 'mancefkhelili-droid.github.io') {
      const redirectUrl = new URL('https://medad-eta.vercel.app/');
      redirectUrl.search = window.location.search;
      redirectUrl.hash = window.location.hash;
      window.location.replace(redirectUrl.href);
    }

try{var t=localStorage.getItem("medad-theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}

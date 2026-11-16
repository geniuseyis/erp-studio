export const THEME_KEY = "erp.theme";

/**
 * İlk boyamadan önce çalışır; sayfa yanlış temada bir an bile görünmez.
 * layout.tsx içinde satır içi betik olarak kullanılır (sunucu bileşeni olduğu için ayrı dosyada durur).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;

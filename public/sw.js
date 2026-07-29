// Cache offline do app.
//
// REGRA DE OURO: este arquivo só pode tocar em arquivos do próprio site
// (HTML, JS, CSS, ícones). Ele NUNCA pode entrar no caminho das chamadas ao
// servidor de dados — se responder uma leitura do diário a partir do cache, o
// professor passa a ver uma cópia congelada e acha que nada foi salvo, mesmo
// com o envio tendo funcionado. Foi exatamente o que aconteceu na v11.
const CACHE_NAME = "meu-diario-v12";
const STATIC_ASSETS = ["/", "/index.html", "/icon.png", "/icon-192.png", "/icon-512.png"];
const IS_LOCAL_DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  if (IS_LOCAL_DEV) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (IS_LOCAL_DEV) {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
    );
    self.clients.claim();
    return;
  }

  // Apagar os caches antigos aqui também é o que limpa as respostas do
  // servidor que a v11 gravou por engano nas máquinas já instaladas.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL_DEV) return;
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Qualquer coisa fora do próprio site (Supabase, fontes, etc.) segue direto
  // pra rede, sem passar por cache nenhum.
  if (url.origin !== self.location.origin) return;

  // A página em si vem sempre da rede primeiro: é assim que uma versão nova do
  // app chega em quem já tem o app instalado. O cache só entra se estiver offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? caches.match("/")))
    );
    return;
  }

  // Arquivos estáticos do build (o Vite põe um hash no nome, então um arquivo
  // com o mesmo nome nunca muda de conteúdo): cache primeiro, sem medo.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

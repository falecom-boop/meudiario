// Regressao da v11: o service worker respondia TODA requisicao GET a partir do
// cache, inclusive as leituras do diario no Supabase. Resultado: o envio
// funcionava ("salvo na nuvem"), mas ao reabrir o app o professor via uma copia
// congelada e achava que nada tinha sido salvo.
//
// Este teste carrega o public/sw.js de verdade num escopo falso de service
// worker e checa as duas regras que nao podem voltar a ser quebradas:
//   1) chamada pra outro dominio (servidor de dados) nunca e' respondida do cache;
//   2) a pagina em si vem da rede primeiro, senao versao nova nunca chega em
//      quem ja instalou o app.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const swSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function loadServiceWorker({ hostname = "meudiario.app" } = {}) {
  const listeners = new Map();
  const scope = {
    URL,
    self: null,
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined
    },
    fetch: async () => ({ ok: true, type: "basic", clone: () => ({}) })
  };
  scope.self = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: () => {},
    clients: { claim: () => {} },
    registration: { unregister: () => {} },
    caches: scope.caches
  };
  vm.createContext(scope);
  vm.runInContext(swSource, scope);
  return { listeners, scope };
}

function dispatchFetch(listeners, request) {
  let responded = false;
  listeners.get("fetch")({ request, respondWith: () => { responded = true; } });
  return responded;
}

const { listeners } = loadServiceWorker();

// 1) Leituras do servidor de dados tem que passar direto pra rede.
assert.equal(
  dispatchFetch(listeners, {
    method: "GET",
    mode: "cors",
    url: "https://abcxyz.supabase.co/rest/v1/diario_current?select=payload,updated_at&id=eq.123"
  }),
  false,
  "leitura do diario em outro dominio nunca pode ser respondida pelo service worker"
);

assert.equal(
  dispatchFetch(listeners, {
    method: "GET",
    mode: "cors",
    url: "https://abcxyz.supabase.co/rest/v1/diario_actions?user_id=eq.123"
  }),
  false,
  "leitura das acoes pendentes nunca pode ser respondida pelo service worker"
);

// 2) Envios (POST/PATCH) tambem seguem intocados.
assert.equal(
  dispatchFetch(listeners, {
    method: "POST",
    mode: "cors",
    url: "https://abcxyz.supabase.co/rest/v1/diario_actions"
  }),
  false,
  "envio de alteracao nunca pode passar pelo service worker"
);

// 3) A pagina e os arquivos do proprio site continuam com suporte offline.
assert.equal(
  dispatchFetch(listeners, { method: "GET", mode: "navigate", url: "https://meudiario.app/" }),
  true,
  "a pagina do app continua atendida pelo service worker (rede primeiro, cache como reserva)"
);

assert.equal(
  dispatchFetch(listeners, { method: "GET", mode: "no-cors", url: "https://meudiario.app/assets/index-abc123.js" }),
  true,
  "arquivos estaticos do proprio site continuam vindo do cache"
);

// 4) Em desenvolvimento o service worker nao pode interferir em nada.
const dev = loadServiceWorker({ hostname: "localhost" });
assert.equal(
  dispatchFetch(dev.listeners, { method: "GET", mode: "navigate", url: "http://localhost:5173/" }),
  false,
  "em localhost o service worker sai da frente por completo"
);

console.log("sw-safety: OK");

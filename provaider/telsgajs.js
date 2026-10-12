// Plugin para el servidor http://190.112.188.164:64987
// Películas: lee la lista "var movie" de ?watch=<id>&movie
// Series:    lee la lista "var serie" de ?watch=<id>&episode (trae todos los capítulos de la temporada)
// Las URLs vienen en base64 dentro de la página.

const BASE = 'http://190.112.188.164:64987';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// Decodificador base64 propio (en algunos entornos no existen atob ni Buffer)
function b64decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const str = String(input).replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < str.length; i++) {
    acc = (acc << 6) | chars.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

// Si ya es una URL se deja igual; si no, se decodifica de base64
function toUrl(value) {
  if (!value) return null;
  const v = String(value);
  if (/^https?:\/\//i.test(v)) return v;
  const d = b64decode(v);
  return /^https?:\/\//i.test(d) ? d : null;
}

function qualityFrom(name, url) {
  const file = String(url).split('?')[0].split('/').pop();
  const m = /[._ -](2160|1440|1080|720|480|360)p?[._ -]/.exec(file);
  if (m) return m[1] + 'p';
  return /4k|2160/i.test(name) ? '2160p' : 'HD';
}

function langFrom(name, url) {
  if (/lat/i.test(name) || /\.lat\./i.test(url)) return 'Latino';
  if (/sub/i.test(name) || /\.sub\./i.test(url)) return 'Subtitulado';
  if (/esp|spa|cast/i.test(name) || /\.(spa|esp)\./i.test(url)) return 'Latino';
  return name || 'Desconocido';
}

function parseVar(html, varName) {
  const re = new RegExp('var\\s+' + varName + '\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;');
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    return null;
  }
}

function parseMovieList(html) {
  const list = parseVar(html, 'movie');
  if (list) {
    return list
      .filter((e) => e && e.stream)
      .map((e) => ({ name: e.name || '', url: toUrl(e.stream) }))
      .filter((e) => e.url);
  }
  // Respaldo: el <video src="..."> de la página
  const v = /<video[^>]+src="([^"]+)"/i.exec(html);
  return v ? [{ name: '', url: v[1] }] : [];
}

function parseEpisode(html, episode) {
  const list = parseVar(html, 'serie');
  if (!list) return [];
  const ep = list.find((e) => e && Number(e.number) === Number(episode));
  if (!ep) return [];
  const options = [
    { name: 'spa', url: toUrl(ep.mp4_spa) },
    { name: 'sub', url: toUrl(ep.mp4_sub) },
    { name: 'spa', url: toUrl(ep.hls_spa) },
    { name: 'sub', url: toUrl(ep.hls_sub) },
  ];
  return options.filter((o) => o.url);
}

function pageSeason(html) {
  const m = /var\s+season\s*=\s*'?"?(\d+)/.exec(html);
  return m ? Number(m[1]) : null;
}

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res.ok ? res.text() : null;
}

function buildStreams(entries) {
  const seen = {};
  return entries
    .filter((e) => !seen[e.url] && (seen[e.url] = true))
    .map((e) => {
      const lang = langFrom(e.name, e.url);
      const quality = qualityFrom(e.name, e.url);
      const hls = /\.m3u8(\?|$)/i.test(e.url);
      return {
        name: 'Net ' + lang,
        title: lang + ' · ' + quality + (hls ? ' · HLS' : ''),
        url: e.url,
        quality: quality,
        headers: { 'User-Agent': UA },
      };
    });
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType === 'movie') {
      const html = await getHtml(BASE + '/?watch=' + tmdbId + '&movie');
      return html ? buildStreams(parseMovieList(html)) : [];
    }

    if (mediaType === 'tv') {
      const wantedSeason = Number(season) || 1;
      const base = BASE + '/?watch=' + tmdbId + '&episode';

      // Temporada 1 (la que muestra la página por defecto) y, para otras,
      // se prueban parámetros de temporada y se comprueba "var season" de la página.
      const variants = wantedSeason === 1
        ? [base]
        : [base + '&season=' + wantedSeason, base + '&s=' + wantedSeason, base + '&temporada=' + wantedSeason];

      for (const url of variants) {
        const html = await getHtml(url);
        if (!html) continue;
        const got = pageSeason(html);
        if (got !== null && got !== wantedSeason) continue; // la página no es la temporada pedida
        const entries = parseEpisode(html, episode);
        if (entries.length) return buildStreams(entries);
      }
      return [];
    }

    return [];
  } catch (err) {
    return [];
  }
}

module.exports = { getStreams, parseMovieList, parseEpisode, b64decode };
         

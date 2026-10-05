// Lee variables de entorno tolerando errores típicos al pegarlas en Railway:
// espacios, comillas alrededor o un "=" de más al principio ("=valor", "NOMBRE=valor").
function env(name, fallback = '') {
  let v = process.env[name];
  if (v == null) return fallback;
  v = String(v).trim();
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1);
  v = v.replace(/^=+/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return v || fallback;
}

module.exports = { env };

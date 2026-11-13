#!/usr/bin/env python3
"""Genera el Home pre-armado de Xuper y lo escribe en home/feed.json.

Xuper NO es Xtream: habla con el portal Magis (POST cifrado 3DES). El kit de JS no puede cifrar headless,
así que el feed se genera en Python reutilizando el cliente del seed-minter (iptv_client.py), que ya tiene
el 3DES + la clave + seeds locales. Se bajan y descifran las 4 columnas raíz (pelis/series/anime/infantil)
tal como las pide el plugin (getNextColumns, pageSize=60) y se publican en texto plano. El plugin lee ese
JSON en arranque frío y arma el Home al instante, SIN portal ni sesión (browsing resiliente aunque las
seeds estén caídas). Reproducir/entrar a una categoría sí sigue usando la sesión.

Corre en el Mac (IP que alcanza el portal) por launchd. Uso:
  python3 scripts/gen-home.py [--minter ~/kino-seed-minter] [--out home/feed.json] [--size 60]
"""
import os, sys, json, time, base64, argparse, pathlib

ROOTS = [("peliculas", "masnew_movies"), ("series", "masnew_series"),
         ("anime", "masnew_anime"), ("infantil", "masnew_kids")]
SCHEMA = 1

# El plugin (homeTree.parseTree + itemFrom) solo usa de cada columna `name` y `assetList`, y de cada asset estos campos
# e imágenes posterList de fileType icon/poster. Se recorta a eso para que el feed no pese megas (el resto no se lee).
ASSET_KEYS = ("contentId", "name", "programType", "duration", "score", "shelveTime", "tags", "description", "posterUrl")
POSTER_TYPES = {"icon", "poster"}

DESC_MAX = 400  # la sinopsis del card no necesita el texto completo

def trim_asset(a):
    out = {k: a[k] for k in ASSET_KEYS if a.get(k) not in (None, "")}
    if isinstance(out.get("description"), str) and len(out["description"]) > DESC_MAX:
        out["description"] = out["description"][:DESC_MAX].rstrip() + "…"
    # imageOf toma la PRIMERA entrada de cada fileType → basta con una icon y una poster.
    pl = a.get("posterList")
    if isinstance(pl, list):
        kept, seen = [], set()
        for p in pl:
            if isinstance(p, dict) and p.get("fileType") in POSTER_TYPES and p.get("fileUrl") and p["fileType"] not in seen:
                kept.append({"fileType": p["fileType"], "fileUrl": p["fileUrl"]})
                seen.add(p["fileType"])
        if kept:
            out["posterList"] = kept
    return out

# El Home/section muestran una vista previa por fila; "ver todo" de una categoría se pide en vivo al entrar (browse).
# Con ~24 ítems por fila basta y el feed no se infla.
ITEMS_PER_COLUMN = 24

def trim_column(c):
    assets = [a for a in (c.get("assetList") or []) if isinstance(a, dict)][:ITEMS_PER_COLUMN]
    return {"name": c.get("name"), "assetList": [trim_asset(a) for a in assets]}

def main():
    ap = argparse.ArgumentParser()
    here = pathlib.Path(__file__).resolve().parent
    ap.add_argument("--minter", default=str(pathlib.Path.home() / "kino-seed-minter"))
    ap.add_argument("--out", default=str(here.parent / "home" / "feed.enc.json"))
    ap.add_argument("--key", default=str(pathlib.Path.home() / ".config" / "kino-xuper" / "feed.key"))
    ap.add_argument("--size", type=int, default=60)   # = TREE_PAGE_SIZE del plugin
    ap.add_argument("--max-seeds", type=int, default=12)
    args = ap.parse_args()

    # Clave AES-256 (hex) para sellar el feed como el de las semillas: el plugin la abre con kino.secret("feedKey"); una copia
    # del código fuera de Kino (un fork) no puede. Se lee de un archivo local (nunca va al repo).
    key_hex = pathlib.Path(args.key).expanduser().read_text().strip()
    key = bytes.fromhex(key_hex)
    if len(key) != 32:
        print(f"clave inválida ({len(key)} bytes, deben ser 32)"); return 1

    minter = str(pathlib.Path(args.minter).expanduser())
    os.chdir(minter)            # para que iptv_client encuentre ./.env (la clave 3DES)
    sys.path.insert(0, minter)
    from iptv_client import IPTVClient  # noqa: E402

    seeds = json.load(open(os.path.join(minter, "minted_seeds.json")))
    seeds = seeds if isinstance(seeds, list) else seeds.get("seeds", [])
    print(f"seeds locales: {len(seeds)}")

    def fetch_all_roots(seed):
        """Baja las 4 raíces con una seed; devuelve {root: resp} o None si alguna falla."""
        c = IPTVClient(user_id=seed.get("userId"), user_token=seed.get("userToken"))
        out = {}
        for root, code in ROOTS:
            r = c.next_columns(code, page=1, size=args.size)
            if not isinstance(r, dict) or r.get("_error") or r.get("_exception") or not r.get("recommendList"):
                print(f"  raíz {root} ({code}) falló: {r.get('_error') or r.get('_exception') if isinstance(r, dict) else r}")
                return None
            cols = [trim_column(c) for c in r["recommendList"] if isinstance(c, dict) and c.get("name")]
            out[root] = {"recommendList": cols}
            print(f"  raíz {root}: {len(cols)} columnas")
        return out

    roots = None
    for s in seeds[:args.max_seeds]:
        try:
            roots = fetch_all_roots(s)
            if roots:
                print(f"seed usada: {s.get('userId')}")
                break
        except Exception as e:
            print(f"  seed {s.get('userId')} excepción: {repr(e)[:120]}")

    if not roots:
        print("NO se pudo armar el feed (ninguna seed sirvió). No se escribe nada.")
        return 1

    feed = {"v": SCHEMA, "at": int(time.time() * 1000), "roots": roots}
    plain = json.dumps(feed, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    # Sello AES-256-GCM, mismo formato que las semillas (seedBox.js): { v:1, iv:b64(12B), data:b64(ciphertext+tag16) }.
    from Crypto.Cipher import AES  # pycryptodome (igual que iptv_client)
    iv = os.urandom(12)
    ct, tag = AES.new(key, AES.MODE_GCM, nonce=iv).encrypt_and_digest(plain)
    envelope = {"v": 1, "iv": base64.b64encode(iv).decode("ascii"), "data": base64.b64encode(ct + tag).decode("ascii")}

    out_path = pathlib.Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(envelope, separators=(",", ":"))
    out_path.write_text(text, encoding="utf-8")
    print(f"listo: {out_path} (claro {round(len(plain)/1024)} KB -> cifrado {round(len(text)/1024)} KB, {len(roots)} raíces)")
    return 0

if __name__ == "__main__":
    sys.exit(main())

"""
ETF 종목명 일괄 업데이트.

tickers_etf_kr.tsv (코드\t이름) 파일을 읽어 tickers.name 컬럼을 덮어쓴다.
pykrx 이름 조회가 실패해 코드가 이름으로 들어간 경우를 정리.

사용법:
    # 로컬 SQLite
    python update_etf_names.py

    # Neon Postgres
    export DATABASE_URL="postgresql://..."
    python update_etf_names.py
"""
from __future__ import annotations

from pathlib import Path

from db import get_conn


TSV = Path(__file__).parent / "tickers_etf_kr.tsv"


def load_name_map() -> dict[str, str]:
    names: dict[str, str] = {}
    for line in TSV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            code, name = parts[0].strip(), parts[1].strip()
            if code and name:
                names[code] = name
    return names


def main() -> None:
    names = load_name_map()
    print(f"[INFO] TSV에서 {len(names)}개 이름 로드")

    conn = get_conn()
    try:
        updated = 0
        missing: list[str] = []
        for code, name in names.items():
            cur = conn.execute(
                "UPDATE tickers SET name = ? WHERE ticker = ?",
                (name, code),
            )
            rc = getattr(cur, "rowcount", None)
            if rc is None:
                rc = getattr(getattr(cur, "_cur", None), "rowcount", 0)
            if rc:
                updated += 1
            else:
                missing.append(code)
        conn.commit()  # psycopg3는 명시적 commit 필요

        print(f"[OK] 업데이트 {updated}개")
        if missing:
            print(f"[WARN] DB에 없는 티커 {len(missing)}개 (backfill 실패 추정):")
            for m in missing[:20]:
                print(f"  - {m}")
            if len(missing) > 20:
                print(f"  ... (+{len(missing) - 20}개 생략)")

        # 검증 샘플
        rows = conn.execute(
            """SELECT ticker, name FROM tickers
               WHERE ticker IN ('091180','433500','360750','498270')
               ORDER BY ticker"""
        ).fetchall()
        print("\n[SAMPLE]")
        for t, n in rows:
            print(f"  {t}  {n}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

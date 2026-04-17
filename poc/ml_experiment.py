"""
실험 1: 월별 상승/하락 예측 — XGBoost vs 통계 기준선

검증 가설:
  XGBoost가 통계 기반(월별 역사적 상승확률) 기준선 대비
  정확도를 10%p 이상 향상시키는가?

방법:
  - 10년 월별 데이터 (≈120개 월) × 여러 종목
  - 시간 순서 기반 분할: 처음 80% 학습, 마지막 20% 테스트 (walk-forward 아님)
  - 기준선:
      * B1: 항상 상승 예측 (다수결)
      * B2: 월별 역사적 상승확률 > 50% → 상승 예측
      * B3: 로지스틱 회귀 (linear 벤치마크)
  - 모델: XGBoost Classifier
  - 지표: accuracy, precision, recall, F1

사용 예:
    python ml_experiment.py 005930
    python ml_experiment.py 005930 AAPL MSFT --plot
    python ml_experiment.py --preset korean_bluechips
"""
from __future__ import annotations

import argparse
import sys
import warnings
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score,
    confusion_matrix,
)
from sklearn.preprocessing import StandardScaler
from tabulate import tabulate
from xgboost import XGBClassifier

from features import build_features


warnings.filterwarnings("ignore", category=UserWarning)

PRESETS: dict[str, list[str]] = {
    "korean_bluechips": ["005930", "000660", "035420", "005380", "051910"],
    "us_bigtech":       ["AAPL", "MSFT", "NVDA", "GOOGL", "META"],
}


# ---- 기준선 모델들 -----------------------------------------------------------

class AlwaysUp:
    """B1: 무조건 상승 예측 (다수결 기준선)."""
    name = "Baseline_AlwaysUp"

    def fit(self, X, y): return self
    def predict(self, X): return np.ones(len(X), dtype=int)


class SeasonalityBaseline:
    """B2: 월별 역사적 상승확률 > 50% → 상승 예측."""
    name = "Baseline_Seasonality"

    def __init__(self):
        self.month_up_prob: dict[int, float] = {}

    def fit(self, X: pd.DataFrame, y):
        df = pd.DataFrame({"month": X["month"].astype(int), "y": y})
        self.month_up_prob = (
            df.groupby("month")["y"].mean().to_dict()
        )
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        probs = X["month"].astype(int).map(self.month_up_prob).fillna(0.5)
        return (probs > 0.5).astype(int).values


class LogRegBaseline:
    """B3: 로지스틱 회귀 (선형 모델 벤치마크)."""
    name = "Baseline_LogReg"

    def __init__(self):
        self.scaler = StandardScaler()
        self.model = LogisticRegression(max_iter=1000)

    def fit(self, X, y):
        Xs = self.scaler.fit_transform(X)
        self.model.fit(Xs, y)
        return self

    def predict(self, X):
        Xs = self.scaler.transform(X)
        return self.model.predict(Xs)


class XGBModel:
    name = "XGBoost"

    def __init__(self):
        self.model = XGBClassifier(
            n_estimators=200,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            random_state=42,
            eval_metric="logloss",
            n_jobs=-1,
        )

    def fit(self, X, y):
        self.model.fit(X, y)
        return self

    def predict(self, X):
        return self.model.predict(X)


# ---- 실험 실행 ---------------------------------------------------------------

def evaluate_ticker(ticker: str, test_ratio: float = 0.2,
                    include_macro: bool = True) -> pd.DataFrame:
    """한 종목에 대해 모든 모델을 비교."""
    feats = build_features(ticker, include_macro=include_macro)
    if len(feats) < 40:
        raise ValueError(
            f"{ticker}: 월별 데이터가 {len(feats)}개로 부족. "
            "먼저 backfill로 10년 데이터를 확보하세요."
        )

    feature_cols = [c for c in feats.columns if c not in ("target_up", "return_pct")]
    X = feats[feature_cols]
    y = feats["target_up"].values

    split = int(len(feats) * (1 - test_ratio))
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y[:split], y[split:]

    models: list = [AlwaysUp(), SeasonalityBaseline(), LogRegBaseline(), XGBModel()]
    rows = []
    for m in models:
        m.fit(X_train, y_train)
        y_pred = m.predict(X_test)
        rows.append({
            "ticker": ticker,
            "model": m.name,
            "accuracy":  accuracy_score(y_test, y_pred),
            "precision": precision_score(y_test, y_pred, zero_division=0),
            "recall":    recall_score(y_test, y_pred, zero_division=0),
            "f1":        f1_score(y_test, y_pred, zero_division=0),
            "n_test":    len(y_test),
        })
    return pd.DataFrame(rows)


def run_experiment(tickers: list[str], test_ratio: float = 0.2,
                   include_macro: bool = True) -> pd.DataFrame:
    all_results = []
    for t in tickers:
        try:
            res = evaluate_ticker(t, test_ratio=test_ratio,
                                  include_macro=include_macro)
            all_results.append(res)
            print(f"[OK] {t}: {len(res)} 모델 평가 완료")
        except Exception as e:  # noqa: BLE001
            print(f"[SKIP] {t}: {e}")
    if not all_results:
        raise RuntimeError("평가 가능한 종목이 없습니다.")
    return pd.concat(all_results, ignore_index=True)


def summarize(results: pd.DataFrame) -> pd.DataFrame:
    """종목 평균으로 모델 간 성능 요약."""
    agg = results.groupby("model").agg(
        accuracy=("accuracy", "mean"),
        precision=("precision", "mean"),
        recall=("recall", "mean"),
        f1=("f1", "mean"),
        tickers=("ticker", "count"),
    ).sort_values("accuracy", ascending=False)
    return agg


def decision_report(summary: pd.DataFrame) -> str:
    """기술 스택 결정을 위한 판정 리포트."""
    xgb_acc = summary.loc["XGBoost", "accuracy"]
    baseline_acc = summary.loc[
        [i for i in summary.index if i.startswith("Baseline")]
    ]["accuracy"].max()
    delta = (xgb_acc - baseline_acc) * 100

    lines = [
        "",
        "=" * 60,
        "판정 (실험 1: ML vs 통계 기준선)",
        "=" * 60,
        f"  최고 기준선 정확도 : {baseline_acc*100:5.2f}%",
        f"  XGBoost  정확도    : {xgb_acc*100:5.2f}%",
        f"  향상폭 (Δ)         : {delta:+.2f}%p",
        "",
    ]
    if delta >= 10:
        lines += [
            "  결론: [OK] ML 채택 권장",
            "  -> Python 백엔드 (FastAPI + XGBoost) 스택 진행",
        ]
    elif delta >= 3:
        lines += [
            "  결론: [MAYBE] 앙상블/추가 피처 검토",
            "  -> 매크로 지표(환율/VIX) 추가 후 재실험",
            "  -> 앙상블 (XGBoost + LogReg + Seasonality) 시도",
        ]
    else:
        lines += [
            "  결론: [NO] ML 우위 없음 -- 단순화 권장",
            "  -> Next.js 풀스택으로 통계 기반 서비스",
            "  -> ML 인프라 불필요, 개발/운영 비용 절감",
        ]
    lines.append("=" * 60)
    return "\n".join(lines)


def plot_comparison(results: pd.DataFrame, outfile: str = "ml_comparison.png") -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    pivot = results.pivot(index="ticker", columns="model", values="accuracy")
    ax = pivot.plot(kind="bar", figsize=(10, 5), ylim=(0, 1))
    ax.set_title("모델별 정확도 (종목별)")
    ax.set_ylabel("Accuracy")
    ax.axhline(0.5, color="gray", linestyle="--", linewidth=0.8)
    ax.legend(loc="lower right", fontsize=8)
    plt.tight_layout()
    plt.savefig(outfile, dpi=100)
    print(f"[OK] 차트 저장: {outfile}")


# ---- CLI ---------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="실험 1: ML vs 기준선")
    p.add_argument("tickers", nargs="*", help="평가할 티커 (예: 005930 AAPL)")
    p.add_argument("--preset", choices=list(PRESETS.keys()))
    p.add_argument("--test-ratio", type=float, default=0.2,
                   help="테스트 세트 비율 (기본 0.2 = 마지막 20%%)")
    p.add_argument("--no-macro", action="store_true",
                   help="매크로 피처 제외 (A/B 비교용)")
    p.add_argument("--ab-macro", action="store_true",
                   help="매크로 포함 vs 제외 A/B 비교 수행")
    p.add_argument("--plot", action="store_true", help="차트 저장")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.preset:
        tickers = PRESETS[args.preset]
    elif args.tickers:
        tickers = args.tickers
    else:
        print("ERROR: 티커 또는 --preset 필요", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] 실험 대상: {tickers}")

    if args.ab_macro:
        print("\n[A/B] 매크로 포함 vs 제외 비교")
        results_no = run_experiment(tickers, args.test_ratio, include_macro=False)
        results_yes = run_experiment(tickers, args.test_ratio, include_macro=True)
        sum_no  = summarize(results_no).add_suffix("_noMacro")
        sum_yes = summarize(results_yes).add_suffix("_withMacro")
        ab = pd.concat([sum_no, sum_yes], axis=1)
        ab["delta_acc_%p"] = (
            (ab["accuracy_withMacro"] - ab["accuracy_noMacro"]) * 100
        )
        print("\n### 매크로 A/B 비교 (모델 평균)\n")
        print(tabulate(ab.round(3), headers="keys", tablefmt="github"))
        # 판정은 매크로 포함 결과 기준
        print(decision_report(summarize(results_yes)))
        if args.plot:
            plot_comparison(results_yes, outfile="ml_comparison_with_macro.png")
        return

    include_macro = not args.no_macro
    results = run_experiment(tickers, test_ratio=args.test_ratio,
                             include_macro=include_macro)

    print("\n### 종목별 상세 결과\n")
    print(tabulate(
        results.round(3),
        headers="keys", tablefmt="github", showindex=False,
    ))

    summary = summarize(results)
    print(f"\n### 모델 평균 성능 (매크로 {'포함' if include_macro else '제외'})\n")
    print(tabulate(
        summary.round(3),
        headers="keys", tablefmt="github",
    ))

    print(decision_report(summary))

    if args.plot:
        plot_comparison(results)


if __name__ == "__main__":
    main()

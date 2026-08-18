"""Merchant segmentation with KMeans.

k is chosen by silhouette score rather than hard-coded, because a user with
six merchants and a user with six hundred need different granularity.
"""
from __future__ import annotations

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

FEATURES = ("total", "frequency", "average_ticket")


def cluster(merchants: list[dict], k: int | None = None) -> dict:
    if len(merchants) < 4:
        return {"clusters": [], "assignments": {}, "silhouette": 0.0, "model": "insufficient-data"}

    X_raw = np.array(
        [[m["total"], m["frequency"], m["average_ticket"]] for m in merchants], dtype=float
    )
    # Log-scale money and counts so a single whale merchant does not define
    # the entire feature space.
    X_raw[:, 0] = np.log1p(X_raw[:, 0])
    X_raw[:, 2] = np.log1p(X_raw[:, 2])
    X = StandardScaler().fit_transform(X_raw)

    best_k, best_score, best_model = 2, -1.0, None
    candidates = [k] if k else range(2, min(6, len(merchants)))
    for candidate in candidates:
        if candidate >= len(merchants):
            continue
        model = KMeans(n_clusters=candidate, n_init=10, random_state=42).fit(X)
        if len(set(model.labels_)) < 2:
            continue
        score = silhouette_score(X, model.labels_)
        if score > best_score:
            best_k, best_score, best_model = candidate, score, model

    if best_model is None:
        return {"clusters": [], "assignments": {}, "silhouette": 0.0, "model": "kmeans-failed"}

    labels = best_model.labels_
    centroids = best_model.cluster_centers_

    clusters = []
    for cid in range(best_k):
        members = [m for m, lbl in zip(merchants, labels) if lbl == cid]
        if not members:
            continue
        avg_freq = float(np.mean([m["frequency"] for m in members]))
        avg_ticket = float(np.mean([m["average_ticket"] for m in members]))
        clusters.append(
            {
                "id": int(cid),
                "label": name_segment(avg_freq, avg_ticket, merchants),
                "size": len(members),
                "centroid": {
                    "total": float(centroids[cid][0]),
                    "frequency": float(centroids[cid][1]),
                    "averageTicket": float(centroids[cid][2]),
                },
            }
        )

    return {
        "clusters": clusters,
        "assignments": {m["key"]: int(lbl) for m, lbl in zip(merchants, labels)},
        "silhouette": float(round(best_score, 4)),
        "model": f"kmeans-k{best_k}",
    }


def name_segment(avg_freq: float, avg_ticket: float, all_merchants: list[dict]) -> str:
    med_freq = float(np.median([m["frequency"] for m in all_merchants]))
    med_ticket = float(np.median([m["average_ticket"] for m in all_merchants]))
    if avg_freq >= med_freq and avg_ticket >= med_ticket:
        return "Habitual big-ticket"
    if avg_freq >= med_freq:
        return "Everyday small spends"
    if avg_ticket >= med_ticket:
        return "Occasional splurges"
    return "Long tail"

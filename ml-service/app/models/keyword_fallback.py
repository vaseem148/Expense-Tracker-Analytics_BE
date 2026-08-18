"""Keyword matcher used before a user has enough data to train on.

Mirrors the TypeScript rules in the API so a prediction never changes meaning
just because it was served by a different tier.
"""
from __future__ import annotations

RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Groceries", ("bigbasket", "dmart", "blinkit", "zepto", "supermarket", "kirana")),
    ("Restaurants", ("swiggy", "zomato", "dominos", "pizza", "restaurant", "biryani", "kfc")),
    ("Coffee", ("starbucks", "cafe", "coffee", "chai")),
    ("Fuel", ("petrol", "diesel", "hpcl", "bpcl", "indian oil", "shell", "fuel")),
    ("Cab & Ride", ("uber", "ola", "rapido", "cab", "taxi")),
    ("Public Transit", ("metro", "irctc", "railway", "redbus")),
    ("Rent", ("rent", "landlord", "lease")),
    ("Electricity", ("electricity", "tneb", "bescom", "power bill")),
    ("Internet", ("broadband", "fiber", "fibernet", "internet")),
    ("Mobile", ("airtel", "jio", "vodafone", "recharge")),
    ("Streaming", ("netflix", "spotify", "prime video", "hotstar", "youtube")),
    ("Pharmacy", ("pharmacy", "medplus", "netmeds", "pharmeasy", "chemist")),
    ("Doctor", ("hospital", "clinic", "diagnostic", "practo")),
    ("Fitness", ("gym", "cult", "fitness", "yoga")),
    ("Clothing", ("myntra", "ajio", "zara", "lifestyle", "westside")),
    ("Electronics", ("croma", "reliance digital", "apple store")),
    ("Shopping", ("amazon", "flipkart", "meesho", "nykaa")),
    ("Travel", ("makemytrip", "goibibo", "indigo", "vistara", "oyo", "airbnb")),
    ("Education", ("udemy", "coursera", "tuition", "byju", "college")),
    ("Insurance", ("insurance", "lic", "premium")),
    ("Subscriptions", ("subscription", "membership", "renewal", "saas")),
    ("Salary", ("salary", "payroll", "stipend")),
    ("Investments", ("dividend", "mutual fund", "zerodha", "groww")),
    ("Refunds", ("refund", "reversal", "cashback")),
]


def guess(text: str) -> tuple[str, float] | None:
    hay = text.lower()
    for label, patterns in RULES:
        if any(p in hay for p in patterns):
            return label, 0.72
    return None

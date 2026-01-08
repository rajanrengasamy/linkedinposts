#!/usr/bin/env python3
"""
Google Trends collector using PyTrends.
Reads JSON from stdin, outputs JSON to stdout.

Usage:
    echo '{"query": "AI agents", "geo": "US", "maxResults": 10}' | python3 trends_collector.py
"""
import sys
import json
import hashlib
import uuid
from datetime import datetime, timezone

try:
    from pytrends.request import TrendReq
except ImportError:
    print(json.dumps({
        "items": [],
        "error": "PyTrends not installed. Run: pip install pytrends"
    }))
    sys.exit(0)

SCHEMA_VERSION = "1.0.0"
NAMESPACE_UUID = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def generate_id(url: str, content_hash: str) -> str:
    """Generate stable UUID v5 from URL and content hash."""
    return str(uuid.uuid5(NAMESPACE_UUID, f"{url}:{content_hash}"))


def generate_content_hash(content: str) -> str:
    """Generate SHA-256 hash of content."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def create_raw_item(title: str, content: str, source_url: str, impressions: int = 0) -> dict:
    """Create a RawItem-compatible dictionary."""
    content_hash = generate_content_hash(content)
    return {
        "id": generate_id(source_url, content_hash),
        "schemaVersion": SCHEMA_VERSION,
        "source": "googletrends",
        "sourceUrl": source_url,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "content": content,
        "contentHash": content_hash,
        "title": title,
        "engagement": {
            "impressions": impressions,
            "likes": None,
            "shares": None,
            "comments": None,
            "views": None
        },
        "citations": [source_url]
    }


def fetch_trends(query: str, geo: str, max_results: int) -> list:
    """Fetch trends data using PyTrends."""
    items = []
    related = {}  # Initialize for use across try blocks

    pytrends = TrendReq(
        hl='en-US',
        tz=360,
        retries=3,
        backoff_factor=1.0,
        timeout=(10, 30)
    )

    # 1. Trending searches (daily hot topics)
    try:
        trending = pytrends.trending_searches(pn=geo.lower())
        for idx, topic in enumerate(trending[0].tolist()[:10]):
            url = f"https://trends.google.com/trends/explore?q={topic.replace(' ', '+')}&geo={geo}"
            items.append(create_raw_item(
                title=f"Trending: {topic}",
                content=f"'{topic}' is currently trending on Google in {geo}. This topic is gaining significant search interest.",
                source_url=url,
                impressions=10000 - (idx * 500)  # Relative ranking
            ))
    except Exception:
        pass  # Continue with other methods

    # 2. Related queries for the user's topic
    try:
        pytrends.build_payload([query], geo=geo, timeframe='now 7-d')
        related = pytrends.related_queries()

        if query in related and related[query]['rising'] is not None:
            rising = related[query]['rising']
            for _, row in rising.head(10).iterrows():
                related_query = row['query']
                url = f"https://trends.google.com/trends/explore?q={related_query.replace(' ', '+')}&geo={geo}"
                items.append(create_raw_item(
                    title=f"Rising: {related_query}",
                    content=f"'{related_query}' is a rising search related to '{query}'. Search interest is increasing rapidly.",
                    source_url=url,
                    impressions=int(row.get('value', 100))
                ))
    except Exception:
        pass  # Continue

    # 3. Top related queries
    try:
        if query in related and related[query]['top'] is not None:
            top = related[query]['top']
            for _, row in top.head(5).iterrows():
                top_query = row['query']
                url = f"https://trends.google.com/trends/explore?q={top_query.replace(' ', '+')}&geo={geo}"
                items.append(create_raw_item(
                    title=f"Top Related: {top_query}",
                    content=f"'{top_query}' is a top search related to '{query}' with sustained high interest.",
                    source_url=url,
                    impressions=int(row.get('value', 50))
                ))
    except Exception:
        pass

    return items[:max_results]


def main():
    try:
        # Read JSON from stdin
        input_data = json.loads(sys.stdin.read())
        query = input_data.get('query', '')
        geo = input_data.get('geo', 'US')
        max_results = input_data.get('maxResults', 25)

        items = fetch_trends(query, geo, max_results)

        print(json.dumps({"items": items}))

    except Exception as e:
        print(json.dumps({"items": [], "error": str(e)}))


if __name__ == "__main__":
    main()

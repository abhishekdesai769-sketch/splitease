# Spliiit — UTM Campaign Link Tracker

All links point to `https://spliiit.klarityit.ca` with UTM parameters appended.
Track PostHog → "Web Analytics" or "Events" → filter by `utm_campaign` to see which source is driving traffic.

---

## Active Campaign Links

| # | Campaign Name | Platform | Use For | Full UTM URL |
|---|---------------|----------|---------|--------------|
| 1 | `r-splitwise` | Reddit | Post in r/Splitwise | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-splitwise` |
| 2 | `r-personalfinancecanada` | Reddit | Post in r/PersonalFinanceCanada | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-personalfinancecanada` |
| 3 | `r-solotravel` | Reddit | Post in r/solotravel | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-solotravel` |
| 4 | `r-malelivingspace` | Reddit | Post in r/malelivingspace | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-malelivingspace` |
| 5 | `r-digitalnomad` | Reddit | Post in r/digitalnomad | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-digitalnomad` |
| 6 | `r-frugal` | Reddit | Post in r/Frugal | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=r-frugal` |
| 7 | `r-splitwise-comments` | Reddit | Dropping in existing comment threads | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=comment&utm_campaign=r-splitwise-comments` |
| 8 | `social-bio` | TikTok / Instagram | Link in bio | `https://spliiit.klarityit.ca?utm_source=social&utm_medium=bio&utm_campaign=social-bio` |

---

## How to Add a New Campaign Link

Follow this pattern:

```
https://spliiit.klarityit.ca?utm_source=SOURCE&utm_medium=MEDIUM&utm_campaign=CAMPAIGN-NAME
```

| Parameter | What it means | Examples |
|-----------|--------------|---------|
| `utm_source` | Where the traffic is coming from | `reddit`, `tiktok`, `instagram`, `email`, `youtube` |
| `utm_medium` | Type of link | `post`, `comment`, `bio`, `story`, `dm`, `email` |
| `utm_campaign` | Specific campaign name (use kebab-case) | `r-splitwise`, `creator-john`, `product-hunt-launch` |

---

## Campaign Log

Use this section to track when each link was deployed and its performance.

| # | Campaign | Date Posted | Post URL / Location | Week 1 Clicks | Week 2 Clicks | Conversions (App Opens) | Notes |
|---|----------|-------------|---------------------|---------------|---------------|--------------------------|-------|
| 1 | `r-splitwise` | 2026-04-23 | | | | | |
| 2 | `r-personalfinancecanada` | | | | | | |
| 3 | `r-solotravel` | | | | | | |
| 4 | `r-malelivingspace` | | | | | | |
| 5 | `r-digitalnomad` | | | | | | |
| 6 | `r-frugal` | | | | | | |
| 7 | `r-splitwise-comments` | 2026-04-23 | | | | | |
| 8 | `social-bio` | | | | | | |

---

## Future Campaigns (add as you launch)

| # | Campaign Name | Platform | Use For | Full UTM URL | Status |
|---|---------------|----------|---------|--------------|--------|
| 9 | `product-hunt` | Product Hunt | PH launch day | `https://spliiit.klarityit.ca?utm_source=producthunt&utm_medium=launch&utm_campaign=product-hunt` | Planned |
| 10 | `creator-[name]` | TikTok/Instagram | Per creator tracking | `https://spliiit.klarityit.ca?utm_source=tiktok&utm_medium=creator&utm_campaign=creator-[name]` | Template |
| 11 | `google-play-launch` | Reddit / Social | Android launch announcement | `https://spliiit.klarityit.ca?utm_source=reddit&utm_medium=post&utm_campaign=google-play-launch` | Planned |
| 12 | `email-welcome` | Email | Welcome email to new signups | `https://spliiit.klarityit.ca?utm_source=email&utm_medium=email&utm_campaign=email-welcome` | Planned |

---

## Where to Check Performance

- **PostHog** → Web Analytics → scroll to "Top referring URLs" or filter events by `utm_campaign`
- Check weekly every Monday morning
- Any campaign with >50 clicks and <2 app opens = landing page or App Store listing problem

---

*Last updated: 2026-04-23*

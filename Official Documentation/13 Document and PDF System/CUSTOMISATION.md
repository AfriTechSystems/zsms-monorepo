# CUSTOMISATION.md — Document Template Customisation Guide

## Related Documents

- `docs/modules/documents/TEMPLATE_SYSTEM.md` — technical template configuration reference
- `docs/modules/documents/PDF_GENERATION.md` — how templates are used in PDF rendering
- `docs/modules/documents/STORAGE.md` — where generated documents are stored
- `docs/modules/school/SUBSCRIPTION.md` — tier determines template level access
- `docs/modules/results/REPORT_CARDS.md` — report card content reference

---

## Purpose

This document is the school-facing practical guide to customising report cards, receipts, and other ZSMS documents. Written for school owners and principals — not developers. No technical knowledge required. Every Claude Code session building the template configuration UI must use this document to ensure the UI matches the guidance given here.

---

## Overview

ZSMS documents represent the school to parents, students, and the community. A well-branded report card with the school logo, colours, and a personal principal's comment leaves a professional impression. The template system makes this achievable in under 10 minutes without any design skills.

**Location:** Settings → Document Templates

---

## Step 1 — Upload Your School Logo

The logo appears on every report card, receipt, and official document ZSMS generates.

**Recommended logo specifications:**
- Format: PNG with transparent background (preferred) or JPG
- Minimum size: 200 × 200 pixels
- Recommended size: 500 × 500 pixels or larger
- Maximum file size: 2MB
- Shape: Square logos work best. Horizontal/landscape logos will appear small in the header.

**How to upload:**
```
Settings → School Profile → Logo → Upload Logo
[Choose file]  → preview appears → [Save logo]
```

The logo is saved to your school's profile and automatically used on all documents. You only need to upload it once. If your logo changes (rebranding), simply upload the new version.

**If you do not have a digital logo:** Most schools have a logo on their letterhead. Take a clear photo of the letterhead with good lighting, crop to just the logo, and upload. Quality will be sufficient for most use cases. For best results, contact a local graphic designer to provide a proper PNG file.

---

## Step 2 — Set Your School Colours

Your primary colour is used for section headers, dividing lines, and borders across all documents. It is the dominant colour on your documents after the logo.

**How to set:**
```
Settings → Document Templates → Colours → Primary Colour
[Colour picker or enter hex code: #1A3C5E]
```

**Colour guidance by school type:**

| School Style | Recommended Colours | Avoid |
|---|---|---|
| Traditional / ECZ | Deep blue (#1A3C5E), Forest green (#2D5016), Maroon (#6B1A1A) | Neon colours, light pastels |
| Cambridge / Modern | Navy (#0F2D6B), Teal (#0D6B6B), Charcoal (#2D2D2D) | Bright red, bright orange |
| Government-affiliated | Black (#000000), Dark navy (#0A1A3C) | Any bright colour |
| Contemporary private | Any professional colour | Very light colours (text becomes invisible) |

**Testing your colour:** After setting the primary colour, open the report card preview (Step 6) to see how it looks with your logo and content.

---

## Step 3 — Choose a Layout Variant (Growth Tier and Above)

Four professionally designed layouts are available. Starter tier schools use the Classic layout by default.

**Previewing layouts:**
```
Settings → Document Templates → Report Card → Layout → [View samples gallery]
```

Each sample shows the layout with your actual logo and colours applied to fictional student data.

### Classic
Traditional formal layout. Clear section boxes with full borders. Professional and familiar — most similar to a government-issued document. Works well for ECZ schools and those who want a conservative presentation. Best for schools where parents expect a traditional format.

### Modern
Clean and contemporary. Colour accent bars replace heavy borders. Section headers use a coloured band rather than a full box. Works well for Cambridge-style schools and newer private schools. Looks excellent when printed in colour.

### Compact
Same content as Classic but with tighter spacing, smaller fonts, and reduced margins. Fits more information on the page — essential for secondary schools where students take 8-10 subjects. If your results table overflows onto a second page in Classic, switch to Compact.

### Formal
Minimal and plain. Black and white. Thin borders only. No colour accents. Suitable for schools with formal associations (government partner schools, examination centres) or those required to submit documents to official bodies where colour printing may not be appropriate.

---

## Step 4 — Configure Report Card Content

```
Settings → Document Templates → Report Card → Content
```

**Student information section:**

| Option | Default | Notes |
|---|---|---|
| Show student photo | On | Requires photo to be uploaded for each student |
| Show date of birth | On | Useful for identification |
| Show examination number | On | Only appears for examination classes (Grade 6, Form 4, Form 6) |

**Results table:**

| Option | Default | Notes |
|---|---|---|
| Show percentage column | On | Shows the raw percentage alongside the grade letter |
| Show maximum marks column | On | Shows the total mark possible |
| Show teacher comments | On | Only appears when comments have been entered |
| Show attendance summary | On | Strongly recommended — parents value this information |
| Show credit count | On | Only appears for ECZ O-Level students |

**Position display format:**

Choose how the student's class position appears:
- Position 3 of 38 ← Most common
- 3rd of 38
- 3/38 ← Most compact

---

## Step 5 — Write the Principal's Comment

The principal's comment appears at the bottom of every report card. It is the same for all students in the school for this term and adds a personal, human touch.

```
Settings → Document Templates → Report Card → Principal's Comment
[Text area — recommended 30-80 words]
[Principal's name: auto-filled from your profile]
```

**Guidance on writing a good principal's comment:**

A good principal's comment:
- Acknowledges the term or academic year
- Encourages students generally
- Mentions something specific to this term (an event, an achievement, a challenge)
- Is warm but professional

**Example — Term 2:**
"As we conclude Term 2, I am proud of the dedication and hard work shown by our students. This has been a term of growth and learning. I encourage every student to continue pushing their limits in Term 3 as we approach the final examinations. Thank you to our parents and guardians for your continued partnership in your child's education."

**Example — Final term (end of year):**
"Congratulations on completing another successful academic year. We have seen tremendous growth in our students and we are proud of every achievement, large and small. We look forward to welcoming you back for the new academic year. Enjoy the holiday season with your families."

**Character limit:** 500 characters maximum. Keep it concise — parents will read a short comment but may skip a very long one.

---

## Step 6 — Configure the Parent Acknowledgement Section

The parent acknowledgement slip at the bottom of the report card asks parents to confirm they have received and read the report.

```
Settings → Document Templates → Report Card → Parent Acknowledgement

Include acknowledgement section: [On / Off]
Tear-off format: [On / Off]
   (Adds a perforated-line marker between the report and the slip)
Return deadline: [date field — optional]
   e.g. "Please return by 25 September 2026"
```

**Tear-off format:** When enabled, the report card prints with a dotted line separating the report from the acknowledgement. Parents sign and detach the slip, returning it to the school. The student retains the report card. This is the standard format for most Zambian private schools.

---

## Step 7 — Configure Receipt Settings

```
Settings → Document Templates → Payment Receipt → Settings
```

| Option | Default | Notes |
|---|---|---|
| Receipt size | A4 portrait | A5 landscape is smaller — easier to file in a physical receipt book |
| Show accountant name | On | Accountability and personalisation |
| Print duplicate copy | Off | Two copies per page — one for parent, one for school files |
| Show school bank details | Off | Add your bank account details to the receipt footer |

**Bank details on receipt:** If parents frequently do bank transfers, showing your school's bank details on every receipt reduces the number of times parents ask for the details. Enable this if your school regularly receives bank transfers.

---

## Step 8 — Configure Attendance Certificate

```
Settings → Document Templates → Attendance Certificate → Settings
```

| Option | Default | Notes |
|---|---|---|
| Certificate title | "Attendance Certificate" | Can be customised: "Certificate of Attendance" |
| Show purpose line | On | "Issued for: [purpose entered by admin]" |
| Show principal signature line | On | Recommended for official submissions |
| Show school stamp box | On | Placeholder for your official rubber stamp |
| Ministry of Education registration number | Off | Enable if required for formal submissions |

---

## Step 9 — Preview Before Generating

**Always preview before bulk generation.** A layout issue in a 400-student school generates 400 wrong PDFs.

```
Settings → Document Templates → Report Card → Preview
[Opens a sample report card PDF in your browser]
```

The preview uses your real logo, colours, and template settings with a fictional student "Tafadzwa Mwale" and typical marks. Review it carefully:

- Does the logo appear correctly and in the right position?
- Are the colours correct?
- Does the results table fit on one page?
- Does the principal's comment look right?
- Does the parent acknowledgement slip appear as expected?

If anything looks wrong, adjust the settings and preview again before generating real report cards.

---

## Custom Templates (Professional and Enterprise Tiers)

Professional and Enterprise tier schools can request a fully custom report card design from AfriTech.

**What custom templates can do that layout variants cannot:**
- Unique page layouts (two-column results tables, large decorative headers)
- Multiple pages (cover page + results page)
- Custom fonts (school's branded typeface)
- Non-standard elements (school crest as watermark, government stamp area)
- Languages other than English in the layout

**How to request a custom template:**

1. Contact AfriTech via support@afritechsystems.com with the subject "Custom Template Request"
2. Provide: your school name, tier, and a brief description of what you need
3. AfriTech will request a specification or design file (PDF, image, or Word document showing the desired layout)
4. AfriTech reviews and builds the template (typically 5-7 business days)
5. A preview is sent for your approval
6. AfriTech activates the custom template on your account

**Common rejection reasons for custom templates:**
- Missing required fields (student ID, school name, academic year must always appear)
- Text that does not fit within A4 dimensions at standard font sizes
- Images or logos that are not provided in high enough resolution
- Designs that use colour in ways that make text unreadable when printed in black and white

---

## Business Rules

1. The logo is uploaded to the school profile — not the template. One logo is shared across all document types.
2. Template settings are per document type — you can use Classic layout for report cards and Formal layout for receipts.
3. The principal's comment is per term — update it before each generation run. The comment is baked into the PDF and cannot be changed after generation without regenerating all report cards.
4. Custom templates require AfriTech approval. Schools cannot activate a custom template themselves.
5. Downgrading from Growth to Starter reverts the layout variant to Classic. The Growth-level settings are preserved in the database — re-upgrading restores them.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 13 documents module documentation |
| 2026-04-26 | Added attendance certificate configuration | Confirmed as sixth document type |
| 2026-04-26 | Added fee statement not in this doc — accountant-facing | Fee statements are generated on-demand by accountants, not configured here |

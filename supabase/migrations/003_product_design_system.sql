-- ============================================================
-- V. GALLERY — SCHEMA v4 (product design system)
-- Run this AFTER 001 and 002, in Supabase SQL Editor.
--
-- The original schema already had frame_style, background, content,
-- and compare_price columns on products — clearly intended to support
-- a richer product design system, but nothing in admin-operations.js
-- or the frontend ever read or wrote them. This migration adds the
-- remaining columns needed to match the full design (per-half
-- backgrounds, typography, visibility toggles, content order, a real
-- media-kind field, and video settings) and backfills existing rows
-- sensibly. All additive — no existing column is dropped or renamed.
-- ============================================================

-- `type` today conflates two different things: the product's
-- CATEGORY (original/print/merch/craft) and, confusingly, 'text' as
-- if it were a media kind. media_kind is the independent axis for
-- "how is this product displayed" (image / video / text), separate
-- from what it's categorized as for filtering.
ALTER TABLE products ADD COLUMN IF NOT EXISTS media_kind TEXT DEFAULT 'image'
    CHECK (media_kind IN ('image', 'video', 'text'));

-- Backfill: any existing row with type='text' almost certainly meant
-- a text/meditation product — set media_kind accordingly so nothing
-- already in the catalog silently loses its display mode.
UPDATE products SET media_kind = 'text' WHERE type = 'text' AND media_kind = 'image';

-- Separate background config for the product half vs. the info half
-- (the original `background` column only supports one). `background`
-- is left in place, unused going forward, rather than dropped —
-- removing a column is destructive and there's no benefit to forcing
-- that here.
ALTER TABLE products ADD COLUMN IF NOT EXISTS background_top JSONB
    DEFAULT '{"type":"color","color1":"#f8f8f8","color2":"#e0e0e0","mediaUrl":""}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS background_bottom JSONB
    DEFAULT '{"type":"color","color1":"#f8f8f8","color2":"#e0e0e0","mediaUrl":""}';

-- Backfill background_top from the legacy single `background` column
-- where one was actually set, so existing customization isn't lost.
UPDATE products
SET background_top = jsonb_build_object(
    'type', COALESCE(background->>'type', 'color'),
    'color1', COALESCE(background->>'color', '#f8f8f8'),
    'color2', '#e0e0e0',
    'mediaUrl', ''
)
WHERE background IS NOT NULL
  AND background_top = '{"type":"color","color1":"#f8f8f8","color2":"#e0e0e0","mediaUrl":""}'::jsonb;

-- Per-product description typography.
ALTER TABLE products ADD COLUMN IF NOT EXISTS font_family TEXT DEFAULT '''Copperplate'', serif';
ALTER TABLE products ADD COLUMN IF NOT EXISTS font_size INTEGER DEFAULT 11;
ALTER TABLE products ADD COLUMN IF NOT EXISTS font_weight INTEGER DEFAULT 400;
ALTER TABLE products ADD COLUMN IF NOT EXISTS text_transform TEXT DEFAULT 'none'
    CHECK (text_transform IN ('none', 'uppercase', 'capitalize'));

-- Visibility toggles and layout order.
ALTER TABLE products ADD COLUMN IF NOT EXISTS show_author BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS show_price BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS show_stock BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_order TEXT DEFAULT 'title-first'
    CHECK (content_order IN ('title-first', 'description-first'));

-- Video-specific playback settings (only meaningful when media_kind='video').
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_autoplay BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_loop BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_muted BOOLEAN DEFAULT true;

SELECT '✅ Schema v4 complete — product design system (media kind, per-half backgrounds, typography, visibility, content order, video settings) is set up.' as status;

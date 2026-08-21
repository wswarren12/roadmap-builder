-- Move every pre-existing roadmap onto the default PL palette.
-- Legacy teal (slot 1) and olive (slot 5) become PL blue/navy slots so green
-- remains reserved for completed items. Values above 9 came from palette cycling.

UPDATE roadmaps
SET palette = 'pl'
WHERE palette IS DISTINCT FROM 'pl';

UPDATE roadmap_items
SET color_index = CASE MOD(color_index, 10)
  WHEN 0 THEN 0
  WHEN 1 THEN 2
  WHEN 2 THEN 2
  WHEN 3 THEN 3
  WHEN 4 THEN 4
  WHEN 5 THEN 4
  WHEN 6 THEN 0
  WHEN 7 THEN 1
  WHEN 8 THEN 2
  WHEN 9 THEN 3
END;

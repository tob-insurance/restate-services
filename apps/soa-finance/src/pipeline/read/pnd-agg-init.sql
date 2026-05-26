CREATE TABLE IF NOT EXISTS pnd_agg (
  pol_office VARCHAR(4),
  pol_subclass VARCHAR(4),
  pol_resv VARCHAR(2),
  pol_year VARCHAR(4),
  pol_month VARCHAR(2),
  pol_sequence VARCHAR(8),
  pol_end_no VARCHAR(3),
  pol_note_no VARCHAR(8),
  premium NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  commission NUMERIC DEFAULT 0,
  vat NUMERIC DEFAULT 0,
  w21 NUMERIC DEFAULT 0,
  wtx NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  stamp NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (pol_office, pol_subclass, pol_resv, pol_year, pol_month, pol_sequence, pol_end_no, pol_note_no)
);

CREATE INDEX IF NOT EXISTS idx_pnd_agg_updated ON pnd_agg (last_updated);

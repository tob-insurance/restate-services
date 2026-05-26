CREATE TABLE IF NOT EXISTS dcnote_outstanding (
  dc_office VARCHAR(4),
  dc_year VARCHAR(4),
  dc_month VARCHAR(2),
  dc_mode VARCHAR(2),
  dc_seq VARCHAR(8),
  pol_office VARCHAR(4),
  pol_subclass VARCHAR(4),
  pol_year VARCHAR(4),
  pol_month VARCHAR(2),
  pol_seq VARCHAR(8),
  pol_end_no VARCHAR(3),
  pol_notes_no VARCHAR(8),
  orig_amount NUMERIC,
  settled_amount NUMERIC DEFAULT 0,
  is_outstanding BOOLEAN DEFAULT true,
  last_updated TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (dc_office, dc_year, dc_month, dc_mode, dc_seq)
);

CREATE INDEX IF NOT EXISTS idx_dcnote_outstanding_pol 
ON dcnote_outstanding (pol_office, pol_subclass, pol_year, pol_month, pol_seq, pol_end_no, pol_notes_no) 
WHERE is_outstanding = true;

CREATE INDEX IF NOT EXISTS idx_dcnote_outstanding_updated 
ON dcnote_outstanding (last_updated);

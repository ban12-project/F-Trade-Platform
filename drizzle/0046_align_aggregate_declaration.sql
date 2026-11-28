-- 0004 already appended video. Verify the catalog before recording the corrected snapshot.
DO $$
BEGIN
  IF enum_range(NULL::public.aggregate_type)::text <> '{product,content,rfq,quotation,lead,delivery_confirmation,video}' THEN
    RAISE EXCEPTION 'Unexpected aggregate_type order; inspect pg_enum before migrating';
  END IF;
END
$$;

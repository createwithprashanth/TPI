# XYRA Learning Review Report

- Run ID: learning_20260607_114246
- Project ID: XYRA_E2E_PID_GRID_TEST_20260607
- Provider: mock
- Model: mock
- DB: /Users/prashanththipparthi/Desktop/XYRA Studio/backend/data/xyra_studio.db

## Summary

- Total comments: 35
- By deliverable: `{"instrument_index": 9, "io_list": 9, "piping_mto": 17}`
- By severity: `{"high": 2, "medium": 33}`
- By fix type: `{"benchmark": 2, "model_prompt": 2, "mto_grouping": 15, "ui_review_flag": 16}`

## Deliverable Reviews

### Instrument Index

- Grade: `B`
- Summary: Mock review inspected 80 rows and produced teaching comments.
- Comments: 9

1. **MEDIUM** `BLEED-10` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

2. **MEDIUM** `CC` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

3. **MEDIUM** `CP` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

4. **HIGH** `FE` `line_tag`
   - Issue: Inline/process-facing item is missing connected line context.
   - Suggestion: 
   - Fix type: `benchmark`
   - Evidence needed: Pipe label nearest the component or connected-line geometry evidence.

5. **MEDIUM** `FE` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

6. **MEDIUM** `FIC` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

7. **MEDIUM** `FIT` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

8. **MEDIUM** `FQI` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

9. **MEDIUM** `FROM-12330-FROM` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

### Io List

- Grade: `B`
- Summary: Mock review inspected 80 rows and produced teaching comments.
- Comments: 9

1. **MEDIUM** `BLEED-10` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

2. **MEDIUM** `CC` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

3. **MEDIUM** `CP` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

4. **HIGH** `FE` `line_tag`
   - Issue: Inline/process-facing item is missing connected line context.
   - Suggestion: 
   - Fix type: `benchmark`
   - Evidence needed: Pipe label nearest the component or connected-line geometry evidence.

5. **MEDIUM** `FE` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

6. **MEDIUM** `FIC` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

7. **MEDIUM** `FIT` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

8. **MEDIUM** `FQI` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

9. **MEDIUM** `FROM-12330-FROM` `review_required`
   - Issue: Row is still flagged for engineer review.
   - Suggestion: 
   - Fix type: `ui_review_flag`
   - Evidence needed: Reason code and checkprint evidence.

### Piping Mto

- Grade: `B`
- Summary: Mock review inspected 5 rows and produced teaching comments.
- Comments: 17

1. **MEDIUM** `H.1` `piping_class`
   - Issue: MTO row is missing piping class.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

2. **MEDIUM** `H.1` `rating`
   - Issue: MTO row is missing rating.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

3. **MEDIUM** `H.1` `end_connection`
   - Issue: MTO row is missing end connection.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

4. **MEDIUM** `H.2` `piping_class`
   - Issue: MTO row is missing piping class.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

5. **MEDIUM** `H.2` `rating`
   - Issue: MTO row is missing rating.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

6. **MEDIUM** `H.2` `end_connection`
   - Issue: MTO row is missing end connection.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

7. **MEDIUM** `H.2` `material_description`
   - Issue: MTO row is missing material description.
   - Suggestion: 
   - Fix type: `model_prompt`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

8. **MEDIUM** `H.3` `piping_class`
   - Issue: MTO row is missing piping class.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

9. **MEDIUM** `H.3` `rating`
   - Issue: MTO row is missing rating.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

10. **MEDIUM** `H.3` `end_connection`
   - Issue: MTO row is missing end connection.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

11. **MEDIUM** `H.4` `piping_class`
   - Issue: MTO row is missing piping class.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

12. **MEDIUM** `H.4` `rating`
   - Issue: MTO row is missing rating.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

13. **MEDIUM** `H.4` `end_connection`
   - Issue: MTO row is missing end connection.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

14. **MEDIUM** `H.4` `material_description`
   - Issue: MTO row is missing material description.
   - Suggestion: 
   - Fix type: `model_prompt`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

15. **MEDIUM** `H.5` `piping_class`
   - Issue: MTO row is missing piping class.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

16. **MEDIUM** `H.5` `rating`
   - Issue: MTO row is missing rating.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

17. **MEDIUM** `H.5` `end_connection`
   - Issue: MTO row is missing end connection.
   - Suggestion: 
   - Fix type: `mto_grouping`
   - Evidence needed: Project valve data sheet, class/spec table, legend, or nearby line/class evidence.

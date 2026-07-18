# Host Workflow Batch — Manual Field-Verification Checklist

Run in a browser with **two host sessions** (two devices, or one normal + one incognito window,
both logged into the same restaurant). Backend must be a build that includes this batch
(new endpoints: `/call-logs/callbacks`, `/waitlist/:id/table-ready`).

Label the sessions **Device A** and **Device B**.

## 1. Callback queue (FIFO)

1. Create three callback entries. Easiest: have the Link webhook fire three missed calls
   (or use `backend/scripts/verify-host-workflow.mjs` §1 setup against the same server), from
   three different phone numbers, ~1 minute apart.
2. On Device A open the phone panel (יומן שיחות) → tab **חזרה ללקוחות**.
   - [ ] All three appear, ordered oldest-first, positions #1 #2 #3.
   - [ ] Each row shows name (if guest matched), phone, time, and relative wait ("לפני X דק׳").
3. Refresh the page (F5).
   - [ ] Order and positions unchanged.
4. On Device B open the same tab.
   - [ ] Identical order.

## 2. Concurrency

5. On **Device B**, press **התחל חזרה** on the **second** callback.
   - [ ] Device B row turns "בטיפול — <host name>".
   - [ ] Device A shows the same within ~2s (SSE) without refresh.
6. On **Device A**, press התחל חזרה on that same callback (if still visible as actionable via a stale view, e.g. before the SSE lands).
   - [ ] A clear "כבר בטיפול של …" notice appears; nothing is overwritten.
7. Tap the phone number on a tablet/phone device.
   - [ ] A dial intent opens (tel: link).

## 3. Completing

8. On Device A press **טופל** on the **first** callback.
   - [ ] It leaves the active queue; the remaining entries move up (former #2 → #1).
   - [ ] It appears under "טופלו לאחרונה" with the completing host's name.
   - [ ] Device B updates without refresh.
9. Add/edit a note (✎) on an open callback and save.
   - [ ] Note persists after refresh and shows on the other device.
10. Press **הסר** on an invalid entry.
    - [ ] It leaves the queue and shows as בוטל in the recently-handled list.

## 4. Timeline auto-return to Live

With the board **Live** (green LIVE pill visible):

11. Open a **future reservation from the list** (reservations tab).
    - [ ] Board jumps to that reservation's time (LIVE pill replaced by "עכשיו" button).
    - Close the drawer (X).
    - [ ] Board returns to Live automatically — current time, LIVE pill back, no manual "עכשיו" press.
12. Repeat for each of these workflows — each must end back in Live after the drawer/mode closes:
    - [ ] Open reservation details from the floor context menu.
    - [ ] Select a reservation from the reorganize queue.
    - [ ] "Choose table" / assign-table flow (בחר שולחן) — complete the assignment, close drawer.
    - [ ] Seat a guest from the drawer (seating completes and drawer closes).
    - [ ] Change-table pick mode — complete it; also cancel it (both restore).
13. Watch for ~90 seconds after a return.
    - [ ] No repeated jumping / no loop; the live ticker advances normally.

## 5. Host navigation is never fought

14. Manually browse to a **future time** with +30 / date picker.
    - [ ] The board stays where you put it (no auto-return).
15. While browsing that future time, open a reservation from the list and close it.
    - [ ] Board returns to **your chosen planning time**, NOT to Live.
16. While a drawer is open (after a system jump), manually press +30.
    - [ ] Closing the drawer now leaves the board alone (manual navigation won).

## 6. מזדמנים terminology

17. Check the host UI in Hebrew:
    - [ ] Reservation panel tab reads **מזדמנים**.
    - [ ] Add button reads **הוסף למזדמנים** / **+ הוסף מזדמן**.
    - [ ] Empty state: **אין מזדמנים כרגע**; footer count: **N מזדמנים**.
    - [ ] Floor context-menu action reads מזדמנים.
    - [ ] Literal waiting phrases still correct: "ממתין 12 דק׳", reservation status "ממתין" (PENDING).

## 7. Custom seating duration

18. Add a מזדמן with **60 minutes** (quick-pick 60) — note the expected end time shown
    (e.g. added 20:00 + 60 → "סיום משוער 21:00").
19. Refresh the page and reopen the entry (expand the row).
    - [ ] Duration shows 60 (also on Device B).
20. Seat the guest on a free table.
    - [ ] On the timeline, the created seating block ends 60 minutes after seat time.
21. Open the seated reservation and edit duration to **120**.
    - [ ] Timeline block recalculates to 120 minutes.
22. Try to save a duration of 0 / negative / 20 in the מזדמנים editor.
    - [ ] Rejected (field turns red / server 422); value not saved.
23. New walk-in from CreateDrawer (walk-in tab): default duration should now match the
    restaurant's turn rules (Najma: 120 even for 2 guests).

## 8. Najma messaging (restaurant: slug `njma`)

24. As Najma, create a test reservation for **2 guests** (host-created, with a phone you control).
    - [ ] The RESERVATION_RECEIVED SMS says **כשעתיים** in the duration line.
    - [ ] The policy addon still says "למשך שעתיים".
    - [ ] NO occurrence of "שעה וחצי" anywhere in the message.
25. Preview/trigger the confirmation request and reminder for a Najma reservation.
    - [ ] Every seating-duration reference says two hours.
26. Sanity-check another restaurant (e.g. Eataliano): its messages are unchanged.

## 9. Table-ready message

27. Add a מזדמן with a test phone (your own). Expand the row → press
    **✉ שליחת הודעה — השולחן מוכן**.
    - [ ] Success feedback appears ("הודעת SMS נשלחה").
    - [ ] The SMS arrives on the phone (via the restaurant's InforU sender) with restaurant branding and the guest name.
    - [ ] The entry shows "הודעת השולחן מוכן נשלחה לפני X דק׳".
    - [ ] The guest is **NOT** seated (still in the מזדמנים list, status הוצע/notified).
28. Press the button again.
    - [ ] A warning asks for confirmation, showing when the previous message was sent.
    - [ ] Confirming sends again; cancelling does not.
29. On Device B, expand the same entry.
    - [ ] The "already sent" stamp is visible there too.
30. Check the message log (SMS diagnostics / message_logs): a TABLE_READY row exists with
    timestamp, channel, and status (SENT/FAILED). Force a failure (entry without phone)
    - [ ] Clear error shown; failed attempt recorded.

## 10. RTL / responsive

31. On desktop (≥1280px) and tablet width (~800px), in Hebrew:
    - [ ] Callback queue rows: no clipped buttons, phone numbers render LTR inside RTL text.
    - [ ] מזדמנים duration quick-picks + end-time preview lay out correctly.
    - [ ] Table-ready button reachable and not overlapping timestamps.

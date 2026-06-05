# LiveLaunch

`LiveLaunch` is a browser-based MVP for a real-time visual real estate booking product. It demonstrates:

- Visual tower and floor inventory with live status colors
- Preference filters and recommended available residences
- Timed ten-minute reservation locking and booking confirmation
- Synchronized updates across browser tabs using `BroadcastChannel` and local storage
- Launch-event display with total, available, reserved and booked unit counts plus availability heat map
- Sales analytics view
- Project selector for switching between property launches
- Admin-only control panel for creating projects, apartment names, towers, and units
- Admin-only booking cancellation and project deletion
- Daily CSV/XLSX booking-board upload that synchronizes the selected project's inventory
- Separate administrator and sales-user login accounts
- Admin-only creation and removal of sales login IDs and passwords
- DAC logo branding
- Enhanced launch heat map with unit/facing tiles, hover details, and facing/type/floor/price filters
- Customer booking form with mobile, email, amount, remarks, sales executive, and admin-only booked-customer details
- Creative Studio with PNG template upload, customer photo upload, live text editing, crop/zoom/rotate and color controls
- Draft to pending approval to approved to WhatsApp delivery workflow
- Creative history with filters, view, download and resend actions
- Dashboard cards for bookings, creative requests, approvals and WhatsApp status
- Audit log for user, booking, template and approval activity

## Run

Open `index.html` in a modern browser. On first use, sign in as administrator with:

- Login ID: `admin`
- Password: `Admin@123`

Change the administrator password from **Admin > Change Password**, then create individual sales-user logins from **Admin > Create Sales Login**. Admin can remove sales users from **Active Logins**.

For the multi-screen demo, sign into separate tabs with created user accounts. Use **Inventory** in one tab to reserve or book a unit and keep **Launch Event** visible in another tab; updates appear immediately on both screens.

## Roles

- `Admin`: full access, users, projects, imports, templates, reports and booking cancellation.
- `Creative Team`: PNG template upload and creative management.
- `Sales Manager`: approval screen and reports.
- `Sales User`: booking, customer photo upload, creative generation and send-for-approval.

## Booking and Creative Workflow

When confirming a reserved unit, the app opens a booking form for customer name, mobile, email, booking date, sales person, amount and remarks. Admin users see the stored customer details on the booked unit panel.

In **Creative Studio**, upload/select a PNG template, upload a JPG/JPEG/PNG customer photo, adjust crop and photo controls, edit the customer/project/unit text, save a draft and send it for approval. Sales Manager or Admin can approve/reject in **Approvals**. Approved creatives simulate Meta WhatsApp Cloud API delivery and track `Sent`, `Delivered` and `Read` states.

The **Simulate Booking** button demonstrates sales arriving from another screen. Demo data and password hashes are retained in browser local storage. This is appropriate for an MVP demonstration only; a production version must validate credentials and authorization on a secure backend.

## Daily Booking Board Import

In **Admin**, first select the project to update, then choose a `.csv` or `.xlsx` file in **Upload Booking Board**. The importer recognizes the Cambridge booking-board columns:

- `BLOCK` or `TOWER`
- `FLOOR`
- `UNIT NO`
- `FACING`
- `AVAILABILITY` or `AVAILABLITY`

`AVAILABLE` units are opened for booking, `BLOCKED` units are shown as reserved/blocked, and `BOOKED` or `BLOCKED & BOOKED` units are shown as sold. Uploaded booked records are treated as current inventory state, not as a new sale today.

Keep **Remove units not present in this full daily sheet** checked when uploading a complete daily export. Uncheck it for a partial update containing only changed units.

## Production Notes

This static MVP stores data in browser storage and simulates WhatsApp delivery. Production should move users, bookings, templates, image generation, approval audit logs and WhatsApp Business Cloud API calls to a secure backend with server-side authorization, durable database storage, signed media URLs and webhook-based delivery tracking.

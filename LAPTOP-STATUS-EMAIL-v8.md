# DKF Laptop Assistance v8

- Phone number is required in the public form and validated on the server for all applicant types. Existing database records are preserved; previously blank phone numbers are not retroactively modified.
- Status-change emails use the same DKF branded HTML emailShell as verification and receipt emails, with tailored subject and content for each review status.
- Internal notes are never included in applicant emails.
- An email is sent only when the status actually changes. Saving notes without changing status does not email the applicant.
- Email failures are logged and reflected as `emailSent:false` in the API response; there is no automatic retry yet.
- Do not change Cloudflare Access or database settings. Deploy the complete ZIP via your normal GitHub/Coolify workflow.

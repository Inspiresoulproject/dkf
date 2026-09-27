# Digital Kids Foundation - Coolify Deployment

This package serves the website with Nginx in Docker.

## Coolify
1. Push these files to a Git repository.
2. In Coolify, create a new Application from that repository.
3. Choose Dockerfile as the build pack/build method.
4. Dockerfile location: /Dockerfile
5. Container port: 80
6. Deploy.
7. Add your production domain in Coolify after the first successful deployment.

The current HTML is self-contained. Any form/email behavior implemented only in browser-side HTML/JavaScript should be tested separately before production use.

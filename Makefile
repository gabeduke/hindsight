# Deploying to the Pi. Everything here runs deploy.sh, which reads the host
# from deploy.local.env (the main checkout's, from a worktree).
#
#   make pi-status       is the rig idle? (/api/status: not saving, quiet)
#   make deploy-dry      what a deploy would send and delete; sends nothing
#   make deploy          sync, build on the Pi, restart (clears the ring)
#   make deploy-static   web/static only: no rebuild, no restart, ring kept
#
#   make flows           the user flows (docs/flows.md) against a demo of their own

.PHONY: deploy deploy-dry deploy-static pi-status flows

deploy:
	./deploy.sh

deploy-dry:
	./deploy.sh --dry-run

deploy-static:
	./deploy.sh --static

pi-status:
	./deploy.sh --status

flows:
	node scripts/flows.mjs

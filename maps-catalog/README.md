# Community maps — sources

Station layouts players shared from build mode (**Presets › SHARE TO COMMUNITY**), each approved by a person in
`account.starnetos.com/admin/maps`. One folder per map:

```
maps/<slug>/map.json                  slug, version, title, description, credit, license (CC-BY-4.0), stats, submission
maps/<slug>/build.starnet-build.json  the layout, re-cleaned by frontend/app/buildshare.js (no crew, instructions, folders or made props)
maps/<slug>/still.png                 the picture the reviewer approved
```

Never edit these by hand. `node scripts/pull-map-submissions.mjs` writes them from the approved queue, and
`node scripts/build-map-catalog.mjs` publishes them into `website/maps/<slug>/<version>/` plus the signed index
`website/.well-known/starnet-maps.json`. The build refuses a source the app's cleaner would change.

To take a map down: delete its folder, rebuild, deploy the website. Published version folders stay on the site but are
no longer listed; stations only build what the signed index lists.

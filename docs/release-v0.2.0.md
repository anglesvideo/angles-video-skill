# Angles Video Skills v0.2.0 — see the render before you spend it

This release adds a second Skill, gives both of them a working media path, and puts a preview in front of the first render. The theme is the same throughout: find out what a render will produce before an allowance pays for finding out.

## Two Skills

| Skill | Use it when |
| --- | --- |
| `create-launch-video` | The product is a repository you are working in, or a product page you can name. |
| `create-video-from-recording` | You already have a screen recording of the product and want it in the video. |

`create-launch-video` now accepts a product page as a source, not only a repository. Only the URL you name is read, and its text is treated as content to summarize rather than as instructions to follow.

`create-video-from-recording` is new. Your agent watches the recording locally and writes down what the product does — Angles never sees the file, so a capability the agent does not name cannot appear in the script, however good the footage is. Before anything is uploaded, the agent checks the frames for API keys, customer names, internal URLs, billing details, and stray windows, and stops to ask rather than publishing a recording that shows them.

## Preview before rendering

Both Skills preview the render before the first one starts. A preview writes nothing, records no usage, spends no allowance, and can be repeated. It reports:

- `canRender` and `blockers` — whether this template will accept this concept at all.
- `scenes` — the shot list, with the asset bound to each scene.
- `unusedMedia` — files you supplied that no scene would show. The render would still succeed; it would simply not contain them.
- `warnings` — scenes that fall back to a plain text layout because their content is missing.

## Media

- `upload --file <path>` sends a local image or recording and returns a public URL. Type and the 50MB limit are checked locally, before any bytes are sent.
- An oversized file is refused with the limit and an `ffmpeg` command that brings it under, rather than being silently re-encoded on your machine.
- Clips above the render limits — long edge over 1920px or frame rate over 30fps — are now re-encoded by Angles on the API path as they always were in the browser, so a 4K capture no longer reaches the renderer untouched.
- `--image-asset` and `--video-asset` pass uploads to `preview` and `render`, once per file.
- Media is part of the idempotency key, so re-rendering with a corrected clip is treated as a new render rather than a replay of the one it fixes.
- A render owns the media kinds it names: sending clips replaces the project's clips rather than adding to them, so a retry leaves nothing of the bad upload behind.

## Choosing a template and orientation

- `aspectRatio` is a field on the concept request. Describing the orientation in prose never controlled it.
- `preferredTemplateId` generates all three concepts for one template. A scene plan is written for the template it was generated against, so this is what puts clip slots in the plan — switching template afterwards leaves a plan the new template rejects.
- A `preferredTemplateId` that cannot render the requested `aspectRatio` is rejected before a project, brief, or script is created.
- Every template now carries a `media` block — `acceptsClips`, `acceptsImages`, `minimumClips`, `minimumImages` — derived from the routing the renderer actually runs. Filter on it rather than on template names, which change as templates are added.

## Clearer failures

- A rejected request now reports the fields that were rejected, not `Bad Request Exception`.
- A gateway timeout explains what retrying costs: only `render` spends an allowance, and a repeat with the same idempotency key counts as a retry.
- `status` carries `sceneWarnings`, so a scene that rendered as plain text is a field you can act on rather than a line of prose in a log window that has already scrolled past.

## Install

Paste this into a Codex conversation:

```text
$skill-installer install https://github.com/shuicici/angles-video-skill/tree/main/skills/create-launch-video
```

```text
$skill-installer install https://github.com/shuicici/angles-video-skill/tree/main/skills/create-video-from-recording
```

For a manual Codex installation, clone the repository and link each Skill into `~/.agents/skills`. Existing clones can update with `git pull --ff-only origin main`.

## Verification

- 16 bundled-client tests cover authentication, field-level error reporting, gateway-timeout guidance, multipart upload, upload type and size rejection, preview, asset URL validation, media-aware idempotency keys, render confirmation, and music handling. One of them asserts that both Skills ship a byte-identical client, since each is installed from its own directory.
- 31 backend service tests cover concept options, template media capability, the render preview, upload transcoding, media replacement, scene warnings, and idempotency behaviour.

## Upgrade notes

- A render that names a media kind now replaces that kind rather than merging into it. A render that names no media leaves existing media untouched.
- Media is stored per project, not per video: replacing it also changes what other videos in the same project render with.
- `imageSupport` and `videoSupport` still describe scene slots for editing in the browser. They are not the answer to whether an upload reaches the finished video — read `media` for that.

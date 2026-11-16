/**
 * Animal NPCs → public/models/characters/npcs.glb (glTF SkinnedMesh)
 *   - the 11 anthropomorphic species (characters/npcRig.js), each in two
 *     levels (<id>_lod0 near, <id>_lod1 far), all bound to the player's
 *     skeleton; palette regions and prop ids as custom attributes; morph
 *     targets blink, smile; clips idle, walk, react
 * usage: node build_npcs.mjs
 */
import { NPC_CLIPS } from '../../src/map/characters/playerRig.js'
import { SPECIES, buildNpcMesh } from '../../src/map/characters/npcRig.js'
import { writeSkinnedGlb } from './skinnedGlb.mjs'

const entries = []
for (const id of Object.keys(SPECIES)) for (const lod of [0, 1]) entries.push([`${id}_lod${lod}`, buildNpcMesh(id, lod)])
writeSkinnedGlb('npcs', entries, NPC_CLIPS, { regions: true })

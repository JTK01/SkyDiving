/**
 * Player avatar → public/models/characters/player.glb (glTF SkinnedMesh)
 *   - one skin (19 joints, A-pose rest) shared by player_lod0 (near) and
 *     player_lod1 (far); continuous body with smooth weights + rigid head /
 *     gear parts; morph targets blink, smile; clips idle, walk, freefall,
 *     canopy, landing, photo — see skinnedGlb.mjs, characters/playerRig.js
 * usage: node build_player.mjs
 */
import { PLAYER_CLIPS, buildPlayerMesh } from '../../src/map/characters/playerRig.js'
import { writeSkinnedGlb } from './skinnedGlb.mjs'

writeSkinnedGlb('player', [0, 1].map((lod) => [`player_lod${lod}`, buildPlayerMesh(lod)]), PLAYER_CLIPS)

import * as Builders from './builders'
import * as vscode from 'vscode'
import { ITarget } from './cabal2json'

export type BuilderParamType = 'cabal-v2' | 'stack' | 'none'

export interface BuilderConstructor {
  new (opts: Builders.CtorOpts): Builders.Builder
}

export type TBuilders = Record<BuilderParamType, BuilderConstructor | undefined>

export interface ProjectDesc {
  project: string
  dir?: vscode.Uri
}

export type TargetParamType = (
  | { type: 'component'; target: ITarget; component: string }
  | { type: 'all' }
  | { type: 'auto' }
) &
  ProjectDesc
export type TargetParamTypeForBuilder = (
  | { type: 'component'; component: string }
  | { type: 'all'; targets: ITarget[] }
  | { type: 'auto' }
) &
  ProjectDesc
export type CabalCommand = 'build' | 'clean' | 'test' | 'bench'

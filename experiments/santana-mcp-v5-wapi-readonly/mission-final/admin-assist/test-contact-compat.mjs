import test from 'node:test';import assert from 'node:assert/strict';
import {authorizedIntentContact} from './prepare-contact-compat.ts';
test('preparation accepts existing individually authorized and administrative PROD read sources, never synthetic or denied',()=>{
 const contact={conversation_id:'20000000-0000-4000-8000-000000000001'};
 for(const source of ['sana_panel_fast_snapshot','sana_administrative_read'])assert.equal(authorizedIntentContact(true,{source,contact}),contact);
 for(const source of ['fixture','synthetic_homolog','untrusted'])assert.equal(authorizedIntentContact(true,{source,contact}),null);
 assert.equal(authorizedIntentContact(false,{source:'sana_administrative_read',contact}),null);
});

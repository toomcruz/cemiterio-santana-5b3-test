import {createSingleReviewHandler} from './single-review-core.mjs';
import {sendManualWhatsApp} from './manual-whatsapp';
// The deployed native sender is imported unchanged: no second transport.
export function singleReviewBinding(request:Request,invoke:any,config:any){
 return createSingleReviewHandler({invoke,sendOfficial:sendManualWhatsApp,config})(request);
}

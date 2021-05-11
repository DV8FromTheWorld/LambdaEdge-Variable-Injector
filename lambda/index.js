//NOTHING should be imported outside of this scope
module.exports.handler = require('safe-cfn-custom-resource')(() => {
  const { handleCreateAndUpdate } = require('./handler')

  const PHYSICAL_RESOURCE_ID = 'lambda-edge-variable-injector'
  return  {
    async create(event, context) {
      return {
        id: PHYSICAL_RESOURCE_ID,
        data: await handleCreateAndUpdate(event)
      }
    },

    async update(event, context) {
      return {
        id: PHYSICAL_RESOURCE_ID,
        data: await handleCreateAndUpdate(event)
      }
    },

    async delete(event, context) {
      //We don't need to do do anything on delete
    }
  }
})

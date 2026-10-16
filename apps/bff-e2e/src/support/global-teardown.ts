// Deliberately nothing to tear down: the stack under test is long-lived and shared. (The Nx
// scaffold's killPort(port) here would kill Docker's port-forwarding process on the host.)
module.exports = async function () {
  return undefined;
};

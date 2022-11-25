package quarry

import (
	"fmt"

	"github.com/filecoin-project/go-address"
	"github.com/ipfs/go-cid"
	hamt "github.com/ipld/go-ipld-adl-hamt"
	"github.com/ipld/go-ipld-prime"
	"github.com/ipld/go-ipld-prime/datamodel"
	"github.com/ipld/go-ipld-prime/linking"
	cidlink "github.com/ipld/go-ipld-prime/linking/cid"
	"github.com/ipld/go-ipld-prime/node/basicnode"
	"github.com/ipld/go-ipld-prime/node/bindnode"
	sb "github.com/ipld/go-ipld-prime/traversal/selector/builder"
	mh "github.com/multiformats/go-multihash"
)

const FilecoinHamtReifier = "quarry-filecoin-hamt"

func AddQuarryReificationToLinkSystem(lsys *ipld.LinkSystem) {
	if lsys.KnownReifiers == nil {
		lsys.KnownReifiers = make(map[string]linking.NodeReifier)
	}
	lsys.KnownReifiers[FilecoinHamtReifier] = ReifyFilecoinHamt
}

func FilecoinHamtActorStateSelector(actor address.Address) datamodel.Node {
	ssb := sb.NewSelectorSpecBuilder(basicnode.Prototype.Any)
	ss := ssb.ExploreInterpretAs(FilecoinHamtReifier,
		ssb.ExploreFields(func(efsb sb.ExploreFieldsSpecBuilder) {
			efsb.Insert(string(actor.Bytes()), ssb.Matcher())
		}),
	)
	return ss.Node()
}

func ReifyFilecoinHamt(lnkCtx ipld.LinkContext, maybeHamtRoot ipld.Node, lsys *ipld.LinkSystem) (ipld.Node, error) {

	builder := hamt.FilecoinV3Prototype{}.NewBuilder().(*hamt.Builder)
	builder = builder.WithLinking(*lsys, cidlink.LinkPrototype{Prefix: cid.Prefix{
		Codec:    cid.DagCBOR,
		MhType:   mh.BLAKE2B_MIN + 31,
		MhLength: -1,
		Version:  1,
	}})
	nd := builder.Build().(*hamt.Node)

	hmnb := hamt.HashMapNodePrototype.Representation().NewBuilder()
	if err := hmnb.AssignNode(maybeHamtRoot); err != nil {
		return nil, err
	}
	hmn := bindnode.Unwrap(hmnb.Build()).(*hamt.HashMapNode)
	if hmn == nil {
		return nil, fmt.Errorf("could not unwrap bindnode into HashMapNode")
	}
	nd.Hamt = *hmn
	return nd, nil
}
